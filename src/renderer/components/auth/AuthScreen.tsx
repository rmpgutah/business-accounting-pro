import React, { useState, useEffect, useRef } from 'react';
import { LogIn, UserPlus, Eye, EyeOff, ArrowRight, Users, Lock, Shield } from 'lucide-react';
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

  // Form fields
  const [email, setEmail] = useState(() => localStorage.getItem(SAVED_EMAIL_KEY) || '');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const savedName = localStorage.getItem(SAVED_NAME_KEY) || '';
  const passwordRef = useRef<HTMLInputElement>(null);

  // Check if users exist on mount
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
      } catch {
        setMode('register');
        setHasExisting(false);
      }
    })();
  }, []);

  // Auto-focus password if email is pre-filled
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
      // Save login info if Remember Me is checked
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

  const labelClass = 'text-xs font-semibold uppercase tracking-wider mb-1.5 block';
  const labelColor = { color: '#9e9eab' };

  // Loading state
  if (hasExisting === null) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#0c0c0e' }}>
        <div className="text-sm" style={{ color: '#9e9eab' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen" style={{ background: '#0c0c0e', padding: '24px' }}>
      {/* Drag region for macOS */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '38px', WebkitAppRegion: 'drag' as any, zIndex: 10 }} />

      {/* ── Branded Header ─────────────────────────── */}
      <div className="flex flex-col items-center mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="flex items-center justify-center text-white font-bold text-lg"
            style={{ width: '40px', height: '40px', background: '#3b82f6', borderRadius: '6px' }}
          >
            B
          </div>
          <div>
            <div className="text-lg font-bold" style={{ color: '#ececf0', letterSpacing: '-0.01em' }}>Business Accounting Pro</div>
            <div className="text-xs" style={{ color: '#6a6a78' }}>Professional Financial Management</div>
          </div>
        </div>
      </div>

      {/* ── Pick User Screen ────────────────────────── */}
      {mode === 'pick-user' && (
        <div style={{
          width: '100%', maxWidth: '460px', background: '#151518',
          border: '1px solid #2a2a30', padding: '40px', borderRadius: '6px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div className="flex flex-col items-center mb-6">
            <div className="flex items-center justify-center mb-3" style={{ width: '52px', height: '52px', background: 'rgba(59,130,246,0.12)', borderRadius: '8px' }}>
              <Users size={26} color="#3b82f6" />
            </div>
            <h1 className="text-lg font-bold" style={{ color: '#ececf0' }}>Welcome Back</h1>
            <p className="text-sm mt-1" style={{ color: '#9e9eab' }}>Select your account to continue</p>
          </div>

          <div className="flex flex-col gap-2 mb-4">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => handlePickUser(u)}
                className="flex items-center gap-3 w-full text-left transition-all duration-150"
                style={{
                  padding: '14px', background: '#1c1c20', border: '1px solid #2a2a30',
                  borderRadius: '4px', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#50505a'; e.currentTarget.style.background = '#232328'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a30'; e.currentTarget.style.background = '#1c1c20'; }}
              >
                <div
                  className="flex items-center justify-center text-white font-bold shrink-0"
                  style={{ width: '40px', height: '40px', borderRadius: '6px', background: u.avatar_color || '#3b82f6', fontSize: '15px' }}
                >
                  {u.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold" style={{ color: '#ececf0' }}>{u.display_name}</div>
                  <div className="text-xs" style={{ color: '#6a6a78' }}>{u.email}</div>
                </div>
                <ArrowRight size={16} style={{ color: '#6a6a78' }} />
              </button>
            ))}
          </div>

          <button
            onClick={() => { setMode('register'); setError(''); }}
            className="w-full flex items-center justify-center gap-2 text-sm transition-all duration-150"
            style={{ padding: '10px', background: 'transparent', border: '1px solid #2a2a30', borderRadius: '4px', color: '#9e9eab', cursor: 'pointer' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#50505a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2a30'; }}
          >
            <UserPlus size={14} />
            Create New Account
          </button>
        </div>
      )}

      {/* ── Login Screen ─────────────────────────────── */}
      {mode === 'login' && (
        <div style={{
          width: '100%', maxWidth: '460px', background: '#151518',
          border: '1px solid #2a2a30', padding: '40px', borderRadius: '6px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div className="flex flex-col items-center mb-6">
            <div className="flex items-center justify-center mb-3" style={{ width: '52px', height: '52px', background: 'rgba(59,130,246,0.12)', borderRadius: '8px' }}>
              <LogIn size={26} color="#3b82f6" />
            </div>
            {savedName && rememberMe ? (
              <>
                <h1 className="text-lg font-bold" style={{ color: '#ececf0' }}>Welcome back, {savedName}</h1>
                <p className="text-sm mt-1" style={{ color: '#9e9eab' }}>Enter your password to continue</p>
              </>
            ) : (
              <>
                <h1 className="text-lg font-bold" style={{ color: '#ececf0' }}>Sign In</h1>
                <p className="text-sm mt-1" style={{ color: '#9e9eab' }}>Enter your credentials to continue</p>
              </>
            )}
          </div>

          {error && (
            <div className="text-sm mb-4" style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: '4px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className={labelClass} style={labelColor}>Email</label>
              <input
                type="email"
                className="block-input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus={!email}
              />
            </div>
            <div className="mb-4">
              <label className={labelClass} style={labelColor}>Password</label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  type={showPassword ? 'text' : 'password'}
                  className="block-input"
                  style={{ paddingRight: '40px' }}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus={!!email}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6a6a78' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="accent-blue-500"
                style={{ width: '16px', height: '16px', borderRadius: '3px' }}
              />
              <span className="text-sm" style={{ color: '#9e9eab' }}>Remember me</span>
            </label>

            <button
              type="submit"
              disabled={!email.trim() || !password || loading}
              className="block-btn-primary w-full flex items-center justify-center gap-2"
              style={{ padding: '12px', fontSize: '0.9375rem', opacity: (!email.trim() || !password || loading) ? 0.5 : 1 }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="flex justify-between mt-4">
            {users.length > 1 && (
              <button onClick={() => { setMode('pick-user'); setError(''); }} className="text-sm" style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer' }}>
                Switch Account
              </button>
            )}
            <button onClick={() => { setMode('register'); setError(''); }} className="text-sm" style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', marginLeft: 'auto' }}>
              Create Account
            </button>
          </div>
        </div>
      )}

      {/* ── Register Screen ──────────────────────────── */}
      {mode === 'register' && (
        <div style={{
          width: '100%', maxWidth: '460px', background: '#151518',
          border: '1px solid #2a2a30', padding: '40px', borderRadius: '6px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}>
          <div className="flex flex-col items-center mb-6">
            <div className="flex items-center justify-center mb-3" style={{ width: '52px', height: '52px', background: 'rgba(34,197,94,0.12)', borderRadius: '8px' }}>
              <UserPlus size={26} color="#22c55e" />
            </div>
            <h1 className="text-lg font-bold" style={{ color: '#ececf0' }}>
              {hasExisting ? 'New Account' : 'Create Your Account'}
            </h1>
            <p className="text-sm mt-1" style={{ color: '#9e9eab' }}>
              {hasExisting ? 'Add a new user to this installation' : 'Set up your first account to get started'}
            </p>
          </div>

          {error && (
            <div className="text-sm mb-4" style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', borderRadius: '4px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleRegister}>
            <div className="mb-4">
              <label className={labelClass} style={labelColor}>Full Name</label>
              <input
                type="text"
                className="block-input"
                placeholder="John Smith"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="mb-4">
              <label className={labelClass} style={labelColor}>Email</label>
              <input
                type="email"
                className="block-input"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="mb-5">
              <label className={labelClass} style={labelColor}>Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="block-input"
                  style={{ paddingRight: '40px' }}
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6a6a78' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password.length > 0 && (
                <div className="text-xs mt-1" style={{ color: password.length < 6 ? '#f59e0b' : '#22c55e' }}>
                  {password.length < 6 ? 'Too short \u2014 min. 6 characters' : 'Looks good'}
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={!displayName.trim() || !email.trim() || password.length < 6 || loading}
              className="block-btn-primary w-full flex items-center justify-center gap-2"
              style={{ padding: '12px', fontSize: '0.9375rem', opacity: (!displayName.trim() || !email.trim() || password.length < 6 || loading) ? 0.5 : 1 }}
            >
              {loading ? 'Creating...' : 'Create Account'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          {hasExisting && (
            <div className="text-center mt-4">
              <button onClick={() => { setMode(users.length > 1 ? 'pick-user' : 'login'); setError(''); }} className="text-sm" style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer' }}>
                Back to Sign In
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Trust Footer ─────────────────────────────── */}
      <div className="flex items-center gap-1.5 mt-6" style={{ color: '#6a6a78', fontSize: '12px' }}>
        <Shield size={12} />
        <span>Secure local encryption \u00b7 Your data stays on this device</span>
      </div>
    </div>
  );
};

export default AuthScreen;
