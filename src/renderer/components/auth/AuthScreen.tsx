import React, { useState, useEffect, useRef } from 'react';
import { LogIn, UserPlus, Eye, EyeOff, ArrowRight, Shield, Lock, BarChart3 } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore, AuthUser } from '../../stores/authStore';
import { useCompanyStore } from '../../stores/companyStore';
import logoUrl from '../../assets/RMPG_WHITE_NEGATIVE_TRANSPARENT_FIXED.png';

type Mode = 'login' | 'register' | 'pick-user';

interface UserEntry {
  id: string;
  email: string;
  display_name: string;
  role: string;
  avatar_color: string;
  last_login: string | null;
}

const SAVED_EMAIL_KEY = 'bap-saved-email';
const SAVED_NAME_KEY  = 'bap-saved-name';
const REMEMBER_KEY    = 'bap-remember';

// Mountain landscape — loads from Unsplash with CSS gradient fallback
// Dark alpine lake at dusk — scenic but dark enough for the white logo to read clearly
const BG_IMAGE = 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=80&auto=format';
const BG_FALLBACK = 'linear-gradient(160deg, #06101e 0%, #0a1628 25%, #0e1d32 50%, #12253f 70%, #07101d 100%)';
// Overlay darkens the photo so the white logo/text stay high-contrast regardless of image
const BG_OVERLAY = 'linear-gradient(rgba(5,10,20,0.55), rgba(5,10,20,0.70))';

const AuthScreen: React.FC = () => {
  const setUser      = useAuthStore((s) => s.setUser);
  const setCompanies = useCompanyStore((s) => s.setCompanies);
  const setActiveCompany = useCompanyStore((s) => s.setActiveCompany);

  // Default to register — useEffect will switch to login if users exist
  const [mode, setMode]             = useState<Mode>('register');
  const [users, setUsers]           = useState<UserEntry[]>([]);
  const [hasExisting, setHasExisting] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem(REMEMBER_KEY) === '1');

  const [email,       setEmail]       = useState(() => localStorage.getItem(SAVED_EMAIL_KEY) || '');
  const [password,    setPassword]    = useState('');
  const [displayName, setDisplayName] = useState('');

  const savedName   = localStorage.getItem(SAVED_NAME_KEY) || '';
  const passwordRef = useRef<HTMLInputElement>(null);

  // Check for existing users — always land on login first
  useEffect(() => {
    (async () => {
      try {
        const has = await api.hasUsers();
        setHasExisting(has);
        if (has) {
          const userList = await api.listUsers();
          setUsers(userList);
          // Multiple users → pick-user, single → login. Always login-first.
          setMode(userList.length > 1 ? 'pick-user' : 'login');
        } else {
          // No users yet — go straight to register
          setMode('register');
        }
      } catch {
        setHasExisting(false);
        setMode('register');
      }
    })();
  }, []);

  useEffect(() => {
    if (mode === 'login' && email && passwordRef.current) {
      setTimeout(() => passwordRef.current?.focus(), 100);
    }
  }, [mode]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.login(email.trim(), password);
      if (rememberMe) {
        localStorage.setItem(SAVED_EMAIL_KEY, email.trim());
        localStorage.setItem(SAVED_NAME_KEY,  result.user.display_name);
        localStorage.setItem(REMEMBER_KEY,    '1');
      } else {
        localStorage.removeItem(SAVED_EMAIL_KEY);
        localStorage.removeItem(SAVED_NAME_KEY);
        localStorage.removeItem(REMEMBER_KEY);
      }
      setUser(result.user);
      if (result.companies.length > 0) {
        setCompanies(result.companies);
        setActiveCompany(result.companies[0]);
        await api.switchCompany(result.companies[0].id);
      }
    } catch (err: any) {
      setError(err?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || !displayName.trim() || loading) return;
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    setError('');
    try {
      const user = await api.register(email.trim(), password, displayName.trim());
      setUser(user as AuthUser);
    } catch (err: any) {
      setError(err?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handlePickUser = (u: UserEntry) => {
    setEmail(u.email);
    setMode('login');
  };

  const goToSetup  = () => { setMode('register'); setError(''); setPassword(''); };
  const goToLogin  = () => { setMode(users.length > 1 ? 'pick-user' : 'login'); setError(''); };

  // ── Styles ────────────────────────────────────────────────
  const labelStyle: React.CSSProperties = {
    color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600,
    marginBottom: '6px', display: 'block',
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px', fontSize: '14px',
    background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px', color: '#fff', outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };
  const inputFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)';
    e.currentTarget.style.boxShadow   = '0 0 0 3px rgba(96,165,250,0.1)';
  };
  const inputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
    e.currentTarget.style.boxShadow   = 'none';
  };
  const btnPrimary: React.CSSProperties = {
    width: '100%', padding: '14px', fontSize: '15px', fontWeight: 600,
    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
    color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
  };
  const glassCard: React.CSSProperties = {
    width: '100%', maxWidth: '440px',
    background: 'rgba(20,23,30,0.82)',
    backdropFilter: 'blur(32px) saturate(1.6)',
    WebkitBackdropFilter: 'blur(32px) saturate(1.6)',
    border: '1px solid rgba(255,255,255,0.10)',
    padding: '44px', borderRadius: '14px',
    boxShadow: '0 32px 80px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset',
  };
  const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', color: '#ef4444',
    fontSize: '13px', cursor: 'pointer', fontWeight: 600,
  };
  const mutedLinkBtn: React.CSSProperties = {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)',
    fontSize: '13px', cursor: 'pointer', transition: 'color 0.2s',
  };
  const errorBox: React.CSSProperties = {
    padding: '12px 14px', marginBottom: '20px',
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
    color: '#f87171', fontSize: '13px', borderRadius: '8px',
  };

  if (hasExisting === null) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh',
        background: `${BG_OVERLAY}, url(${BG_IMAGE}) center/cover no-repeat, ${BG_FALLBACK}`,
        }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '14px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', width: '100%',
      background: `${BG_OVERLAY}, url(${BG_IMAGE}) center/cover no-repeat, ${BG_FALLBACK}`,
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
    }}>
      {/* Drag region for macOS hiddenInset title bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '38px', WebkitAppRegion: 'drag' as any, zIndex: 10 }} />

      {/* ── Left branding panel ───────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '60px', minWidth: '300px' }}>
        <img
          src={logoUrl}
          alt="RMPG Logo"
          style={{
            width: '96px',
            height: '96px',
            objectFit: 'contain',
            marginBottom: '32px',
            filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.5))',
          }}
        />

        <h1 style={{ fontSize: '48px', fontWeight: 800, color: 'white', lineHeight: 1.1, letterSpacing: '-0.02em', marginBottom: '16px' }}>
          Business<br />Accounting<br />Pro
        </h1>
        <p style={{ fontSize: '16px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.6, maxWidth: '400px', marginBottom: '40px' }}>
          Complete financial management for your business. Invoicing, payroll, taxes, debt collection, and 34 integrated modules.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {[
            { Icon: Shield,   color: '#60a5fa', bg: 'rgba(59,130,246,0.15)',  text: 'Secure, encrypted local storage' },
            { Icon: BarChart3, color: '#34d399', bg: 'rgba(34,197,94,0.15)',   text: 'Real-time financial analytics' },
            { Icon: Lock,     color: '#f87171', bg: 'rgba(239,68,68,0.15)',    text: 'Your data never leaves your device' },
          ].map(({ Icon, color, bg, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={color} />
              </div>
              <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>{text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right auth card panel ─────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', minWidth: '480px' }}>

        {/* ── Pick User ──────────────────────────────────── */}
        {mode === 'pick-user' && (
          <div style={glassCard}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>Welcome back</h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '28px' }}>Select your account</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              {users.map((u) => (
                <button
                  key={u.id}
                  onClick={() => handlePickUser(u)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px',
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '10px', cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                >
                  <div style={{ width: '42px', height: '42px', borderRadius: '10px', background: u.avatar_color || '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, color: 'white', flexShrink: 0 }}>
                    {u.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'white' }}>{u.display_name}</div>
                    <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)' }}>{u.email}</div>
                  </div>
                  <ArrowRight size={16} style={{ color: 'rgba(255,255,255,0.3)' }} />
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => { setMode('login'); setError(''); }} style={mutedLinkBtn}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
              >
                <LogIn size={13} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                Use email instead
              </button>
              <button onClick={goToSetup} style={linkBtn}>
                <UserPlus size={13} style={{ display: 'inline', marginRight: '5px', verticalAlign: 'middle' }} />
                New account
              </button>
            </div>
          </div>
        )}

        {/* ── Login (dominant / always-first view) ─────────── */}
        {mode === 'login' && (
          <div style={glassCard}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
              {hasExisting ? 'Welcome back' : 'Sign in'}
            </h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '28px' }}>
              {hasExisting && savedName && rememberMe
                ? `Sign in as ${savedName}`
                : hasExisting
                  ? 'Sign in to your account'
                  : 'No account yet — sign in or set up below'}
            </p>

            {error && <div style={errorBox}>{error}</div>}

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle} htmlFor="auth-email">Email</label>
                <input
                  id="auth-email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus={!email}
                  style={inputStyle}
                  onFocus={inputFocus}
                  onBlur={inputBlur}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle} htmlFor="auth-password">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="auth-password"
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus={!!email}
                    style={{ ...inputStyle, paddingRight: '44px' }}
                    onFocus={inputFocus}
                    onBlur={inputBlur}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '4px' }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444' }} />
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>Remember me</span>
              </label>

              <button
                type="submit"
                disabled={!email.trim() || !password || loading}
                style={{ ...btnPrimary, opacity: (!email.trim() || !password || loading) ? 0.5 : 1 }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.boxShadow = '0 8px 24px rgba(239,68,68,0.4)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.3)'; }}
              >
                {loading ? 'Signing in...' : 'Sign in'}
                {!loading && <LogIn size={16} />}
              </button>
            </form>

            {/* Bottom links — setup is always surfaced */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {users.length > 1 ? (
                <button onClick={() => { setMode('pick-user'); setError(''); }} style={mutedLinkBtn}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                >
                  Switch account
                </button>
              ) : (
                <span />
              )}
              <div>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
                  {hasExisting ? 'Need another account? ' : 'New here? '}
                </span>
                <button onClick={goToSetup} style={linkBtn}>Set up</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Setup / Register ─────────────────────────────── */}
        {mode === 'register' && (
          <div style={glassCard}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
              {hasExisting ? 'Create account' : 'Set up'}
            </h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '28px' }}>
              {hasExisting ? 'Add a new user to this installation' : 'Create your account to get started'}
            </p>

            {error && <div style={errorBox}>{error}</div>}

            <form onSubmit={handleRegister}>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle} htmlFor="reg-name">Full Name</label>
                <input
                  id="reg-name"
                  type="text"
                  name="name"
                  autoComplete="name"
                  placeholder="John Smith"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                  style={inputStyle}
                  onFocus={inputFocus}
                  onBlur={inputBlur}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle} htmlFor="reg-email">Email</label>
                <input
                  id="reg-email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                  onFocus={inputFocus}
                  onBlur={inputBlur}
                />
              </div>
              <div style={{ marginBottom: '28px' }}>
                <label style={labelStyle} htmlFor="reg-password">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="new-password"
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...inputStyle, paddingRight: '44px' }}
                    onFocus={inputFocus}
                    onBlur={inputBlur}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '4px' }}>
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div style={{ fontSize: '12px', marginTop: '6px', color: password.length < 6 ? '#fbbf24' : '#34d399' }}>
                    {password.length < 6 ? 'Too short — min. 6 characters' : 'Looks good'}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!displayName.trim() || !email.trim() || password.length < 6 || loading}
                style={{ ...btnPrimary, opacity: (!displayName.trim() || !email.trim() || password.length < 6 || loading) ? 0.5 : 1 }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.boxShadow = '0 8px 24px rgba(239,68,68,0.4)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.3)'; }}
              >
                {loading ? 'Creating...' : 'Create Account'}
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>

            {/* Always show "Back to login" */}
            <div style={{ textAlign: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Already have an account? </span>
              <button onClick={goToLogin} style={linkBtn}>Sign in</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;
