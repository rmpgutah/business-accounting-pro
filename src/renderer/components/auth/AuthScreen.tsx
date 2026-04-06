import React, { useState, useEffect, useRef } from 'react';
import { LogIn, UserPlus, Eye, EyeOff, ArrowRight, Users, Shield, Lock, BarChart3, Phone } from 'lucide-react';
import api from '../../lib/api';
import { useAuthStore, AuthUser } from '../../stores/authStore';
import { useCompanyStore } from '../../stores/companyStore';

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
const SAVED_NAME_KEY = 'bap-saved-name';
const REMEMBER_KEY = 'bap-remember';

// Background image — dark mountain landscape (embedded as gradient fallback + unsplash)
const BG_IMAGE = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80&auto=format';

const AuthScreen: React.FC = () => {
  const setUser = useAuthStore((s) => s.setUser);
  const setCompanies = useCompanyStore((s) => s.setCompanies);
  const setActiveCompany = useCompanyStore((s) => s.setActiveCompany);

  const [mode, setMode] = useState<Mode>('login');
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [hasExisting, setHasExisting] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem(REMEMBER_KEY) === '1');

  const [email, setEmail] = useState(() => localStorage.getItem(SAVED_EMAIL_KEY) || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const savedName = localStorage.getItem(SAVED_NAME_KEY) || '';
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const has = await api.hasUsers();
        setHasExisting(has);
        if (has) {
          const userList = await api.listUsers();
          setUsers(userList);
          setMode(userList.length > 1 ? 'pick-user' : 'login');
        } else {
          setMode('register');
        }
      } catch (err) {
        console.error('Failed to check for existing users:', err);
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
        localStorage.setItem(SAVED_NAME_KEY, result.user.display_name);
        localStorage.setItem(REMEMBER_KEY, '1');
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

  const labelStyle: React.CSSProperties = { color: 'rgba(255,255,255,0.7)', fontSize: '13px', fontWeight: 600, marginBottom: '6px', display: 'block' };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px 16px', fontSize: '14px',
    background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px', color: '#fff', outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };

  const btnPrimaryStyle: React.CSSProperties = {
    width: '100%', padding: '14px', fontSize: '15px', fontWeight: 600,
    background: 'linear-gradient(135deg, #ef4444, #dc2626)',
    color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(239,68,68,0.3)',
  };

  const glassCardStyle: React.CSSProperties = {
    width: '100%', maxWidth: '440px',
    background: 'rgba(30, 32, 40, 0.65)',
    backdropFilter: 'blur(24px) saturate(1.5)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
    border: '1px solid rgba(255,255,255,0.12)',
    padding: '40px', borderRadius: '16px',
    boxShadow: '0 24px 64px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.05) inset',
  };

  if (hasExisting === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#08090c' }}>
        <div style={{ color: '#9a9db0', fontSize: '14px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', width: '100%',
      backgroundImage: `linear-gradient(rgba(8,9,12,0.55), rgba(8,9,12,0.65)), url(${BG_IMAGE})`,
      backgroundSize: 'cover', backgroundPosition: 'center',
      fontFamily: "'Inter', -apple-system, system-ui, sans-serif",
    }}>
      {/* Drag region for macOS */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '38px', WebkitAppRegion: 'drag' as any, zIndex: 10 }} />

      {/* ── Left Panel: Branding ──────────────────────── */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '60px', minWidth: '300px',
      }}>
        {/* Logo */}
        <div
          style={{
            width: '56px', height: '56px', borderRadius: '12px',
            background: 'linear-gradient(135deg, rgba(59,130,246,0.9), rgba(37,99,235,0.95))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '24px', fontWeight: 800, color: 'white', marginBottom: '32px',
            boxShadow: '0 8px 24px rgba(59,130,246,0.3)',
          }}
        >
          B
        </div>

        <h1 style={{
          fontSize: '48px', fontWeight: 800, color: 'white', lineHeight: 1.1,
          letterSpacing: '-0.02em', marginBottom: '16px',
        }}>
          Business<br />Accounting<br />Pro
        </h1>

        <p style={{
          fontSize: '16px', color: 'rgba(255,255,255,0.6)', lineHeight: 1.6,
          maxWidth: '400px', marginBottom: '40px',
        }}>
          Complete financial management for your business. Invoicing, payroll, taxes, debt collection, and 34 integrated modules.
        </p>

        {/* Feature bullets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={18} color="#60a5fa" />
            </div>
            <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>Secure, encrypted local storage</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart3 size={18} color="#34d399" />
            </div>
            <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>Real-time financial analytics</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Lock size={18} color="#f87171" />
            </div>
            <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)' }}>Your data never leaves your device</span>
          </div>
        </div>
      </div>

      {/* ── Right Panel: Auth Card ────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '40px', minWidth: '480px',
      }}>

        {/* ── Pick User ────────────────────────────────── */}
        {mode === 'pick-user' && (
          <div style={glassCardStyle}>
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
                    borderRadius: '10px', cursor: 'pointer', textAlign: 'left', width: '100%',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                >
                  <div style={{
                    width: '42px', height: '42px', borderRadius: '10px',
                    background: u.avatar_color || '#3b82f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', fontWeight: 700, color: 'white', flexShrink: 0,
                  }}>
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

            <button
              onClick={() => { setMode('register'); setError(''); }}
              style={{
                width: '100%', padding: '12px', background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px',
                color: 'rgba(255,255,255,0.5)', fontSize: '13px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
            >
              <UserPlus size={14} /> Create New Account
            </button>
          </div>
        )}

        {/* ── Login ─────────────────────────────────────── */}
        {mode === 'login' && (
          <div style={glassCardStyle}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
              {savedName && rememberMe ? `Welcome back` : 'Welcome back'}
            </h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '28px' }}>
              {savedName && rememberMe ? `Sign in as ${savedName}` : 'Sign in to your account'}
            </p>

            {error && (
              <div style={{ padding: '12px 14px', marginBottom: '20px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '13px', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus={!email}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(96,165,250,0.1)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={passwordRef}
                    type={showPassword ? 'text' : 'password'}
                    placeholder=""
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus={!!email}
                    style={{ ...inputStyle, paddingRight: '44px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(96,165,250,0.1)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '4px' }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Remember Me */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '24px', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#ef4444', borderRadius: '4px' }}
                />
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)' }}>Remember me</span>
              </label>

              <button
                type="submit"
                disabled={!email.trim() || !password || loading}
                style={{ ...btnPrimaryStyle, opacity: (!email.trim() || !password || loading) ? 0.5 : 1 }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.boxShadow = '0 8px 24px rgba(239,68,68,0.4)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.3)'; }}
              >
                {loading ? 'Signing in...' : 'Sign in'}
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginTop: '20px' }}>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Don't have an account? </span>
              <button
                onClick={() => { setMode('register'); setError(''); }}
                style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}
              >
                Sign up
              </button>
            </div>

            {users.length > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', marginTop: '24px', paddingTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button onClick={() => { setMode('pick-user'); setError(''); }} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '13px', cursor: 'pointer', transition: 'color 0.2s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
                >
                  Switch Account
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Register ──────────────────────────────────── */}
        {mode === 'register' && (
          <div style={glassCardStyle}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'white', marginBottom: '4px' }}>
              {hasExisting ? 'Create account' : 'Get started'}
            </h2>
            <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.5)', marginBottom: '28px' }}>
              {hasExisting ? 'Add a new user to this installation' : 'Set up your first account'}
            </p>

            {error && (
              <div style={{ padding: '12px 14px', marginBottom: '20px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: '13px', borderRadius: '8px' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleRegister}>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Full Name</label>
                <input
                  type="text"
                  placeholder="John Smith"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoFocus
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(96,165,250,0.1)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={labelStyle}>Email</label>
                <input
                  type="email"
                  placeholder="name@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(96,165,250,0.1)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
              <div style={{ marginBottom: '28px' }}>
                <label style={labelStyle}>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Min. 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{ ...inputStyle, paddingRight: '44px' }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(96,165,250,0.1)'; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none'; }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', padding: '4px' }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div style={{ fontSize: '12px', marginTop: '6px', color: password.length < 6 ? '#fbbf24' : '#34d399' }}>
                    {password.length < 6 ? 'Too short \u2014 min. 6 characters' : 'Looks good'}
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={!displayName.trim() || !email.trim() || password.length < 6 || loading}
                style={{ ...btnPrimaryStyle, opacity: (!displayName.trim() || !email.trim() || password.length < 6 || loading) ? 0.5 : 1 }}
                onMouseEnter={(e) => { if (!loading) e.currentTarget.style.boxShadow = '0 8px 24px rgba(239,68,68,0.4)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.3)'; }}
              >
                {loading ? 'Creating...' : 'Create Account'}
                {!loading && <ArrowRight size={16} />}
              </button>
            </form>

            {hasExisting && (
              <div style={{ textAlign: 'center', marginTop: '20px' }}>
                <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>Already have an account? </span>
                <button
                  onClick={() => { setMode(users.length > 1 ? 'pick-user' : 'login'); setError(''); }}
                  style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '13px', cursor: 'pointer', fontWeight: 600 }}
                >
                  Sign in
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthScreen;
