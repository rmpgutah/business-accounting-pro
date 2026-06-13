// Auth helpers — password hashing + JWT (HS256). Pure Web Crypto, no deps.
//
// Password hashing: PBKDF2-HMAC-SHA256, 200k iterations, 16-byte salt, 32-byte
// derived key. PBKDF2 is supported natively by `crypto.subtle` in Workers;
// scrypt isn't (yet), and bcrypt requires WASM. PBKDF2 with 200k iters is the
// OWASP 2025 floor for SHA-256 and well within Worker CPU budget (~25ms).
//
// JWT: standard HS256. Body holds { sub, cid (active company), exp }.
// Tokens last 7 days; renewed on every successful request via Set-Cookie.

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Base64URL helpers ──
function b64uEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Password ──
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveBits(password, salt, 200_000);
  // Storage format: pbkdf2$<iters>$<saltB64u>$<hashB64u> — self-describing so
  // we can bump iter count later without breaking old hashes.
  return `pbkdf2$200000$${b64uEncode(salt)}$${b64uEncode(derived)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iters = parseInt(parts[1], 10);
  if (!Number.isFinite(iters) || iters < 10000) return false;
  const salt = b64uDecode(parts[2]);
  const expected = b64uDecode(parts[3]);
  const got = await deriveBits(password, salt, iters);
  return constantTimeEqual(new Uint8Array(got), expected);
}
async function deriveBits(password: string, salt: Uint8Array, iters: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' },
    key, 256
  );
}
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── JWT (HS256) ──
export interface JWTPayload {
  sub: string;       // user id
  cid?: string;      // active company id (optional — null until first selection)
  role?: string;     // 'user' | 'owner' | 'client'
  exp: number;       // unix seconds
  iat: number;
}
export async function signJWT(payload: Omit<JWTPayload, 'iat' | 'exp'>, secret: string, ttlSec = 7 * 24 * 3600): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JWTPayload = { ...payload, iat: now, exp: now + ttlSec };
  const header = b64uEncode(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64uEncode(enc.encode(JSON.stringify(full)));
  const sig = await hmacSign(`${header}.${body}`, secret);
  return `${header}.${body}.${b64uEncode(sig)}`;
}
export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const sig = await hmacSign(`${h}.${b}`, secret);
  if (!constantTimeEqual(new Uint8Array(sig), b64uDecode(s))) return null;
  try {
    const payload = JSON.parse(dec.decode(b64uDecode(b))) as JWTPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
async function hmacSign(input: string, secret: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(input));
}

// ── Cookie helpers ──
const COOKIE_NAME = 'bap_session';
export function setSessionCookie(token: string, secure = true): string {
  // Set-Cookie attributes:
  //   HttpOnly  → JS in the page can't read it (XSS-safe)
  //   Secure    → HTTPS only (disabled in dev so localhost works)
  //   SameSite=Lax → standard CSRF posture; POSTs from same-origin work fine
  //   Max-Age=7d
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 3600}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const c of cookieHeader.split(';')) {
    const [k, ...rest] = c.trim().split('=');
    if (k === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function uuid(): string {
  return crypto.randomUUID();
}
