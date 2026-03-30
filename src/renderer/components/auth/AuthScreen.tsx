import React, { useState, useEffect } from 'react';
import { Building2, LogIn, UserPlus, Eye, EyeOff, ArrowRight, Users } from 'lucide-react';
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

  // Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.login(email.trim(), password);
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

  const labelClass = 'text-xs font-semibold text-text-muted uppercase tracking-wider mb-1 block';
  const cardStyle: React.CSSProperties = {
    width: '100%', maxWidth: '440px', background: '#141414',
    border: '1px solid #2e2e2e', padding: '32px', borderRadius: '2px',
  };

  // Loading state
  if (hasExisting === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a' }}>
        <div style={{ color: '#a0a0a0', fontSize: '14px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a', padding: '24px' }}>
      {/* Drag region for macOS */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: '38px', WebkitAppRegion: 'drag' as any, zIndex: 10 }} />

      {/* ── Pick User Screen ────────────────────────── */}
      {mode === 'pick-user' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', background: '#3b82f6', marginBottom: '12px', borderRadius: '2px' }}>
              <Users size={24} color="white" />
            </div>
            <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#f0f0f0' }}>Welcome Back</h1>
            <p style={{ fontSize: '13px', color: '#a0a0a0', marginTop: '4px' }}>Select your account</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => handlePickUser(u)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '12px',
                  background: '#1e1e1e', border: '1px solid #2e2e2e', borderRadius: '2px',
                  cursor: 'pointer', textAlign: 'left', width: '100%', transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#525252')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2e2e2e')}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '2px',
                  background: u.avatar_color || '#3b82f6',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '14px', fontWeight: 'bold', color: 'white', flexShrink: 0,
                }}>
                  {u.display_name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#f0f0f0' }}>{u.display_name}</div>
                  <div style={{ fontSize: '12px', color: '#6b6b6b' }}>{u.email}</div>
                </div>
                <ArrowRight size={16} color="#6b6b6b" />
              </button>
            ))}
          </div>

          <button
            onClick={() => { setMode('register'); setError(''); }}
            style={{ width: '100%', padding: '8px', background: 'transparent', border: '1px solid #2e2e2e', borderRadius: '2px', color: '#a0a0a0', fontSize: '13px', cursor: 'pointer' }}
          >
            <UserPlus size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
            Create New Account
          </button>
        </div>
      )}

      {/* ── Login Screen ─────────────────────────────── */}
      {mode === 'login' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', background: '#3b82f6', marginBottom: '12px', borderRadius: '2px' }}>
              <LogIn size={24} color="white" />
            </div>
            <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#f0f0f0' }}>Sign In</h1>
            <p style={{ fontSize: '13px', color: '#a0a0a0', marginTop: '4px' }}>Enter your password to continue</p>
          </div>

          {error && (
            <div style={{ padding: '8px 12px', marginBottom: '16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '13px', borderRadius: '2px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '12px' }}>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus={!email}
              />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label className={labelClass}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="block-input"
                  style={{ width: '100%', paddingRight: '36px' }}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus={!!email}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b6b6b', padding: '4px' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={!email.trim() || !password || loading}
              className="block-btn-primary"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (!email.trim() || !password || loading) ? 0.5 : 1 }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
            {users.length > 1 && (
              <button onClick={() => { setMode('pick-user'); setError(''); }} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '13px', cursor: 'pointer' }}>
                ← Switch Account
              </button>
            )}
            <button onClick={() => { setMode('register'); setError(''); }} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '13px', cursor: 'pointer', marginLeft: 'auto' }}>
              Create Account
            </button>
          </div>
        </div>
      )}

      {/* ── Register Screen ──────────────────────────── */}
      {mode === 'register' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', background: '#22c55e', marginBottom: '12px', borderRadius: '2px' }}>
              <UserPlus size={24} color="white" />
            </div>
            <h1 style={{ fontSize: '18px', fontWeight: 'bold', color: '#f0f0f0' }}>
              {hasExisting ? 'New Account' : 'Create Your Account'}
            </h1>
            <p style={{ fontSize: '13px', color: '#a0a0a0', marginTop: '4px' }}>
              {hasExisting ? 'Add a new user to this installation' : 'Set up your first account to get started'}
            </p>
          </div>

          {error && (
            <div style={{ padding: '8px 12px', marginBottom: '16px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '13px', borderRadius: '2px' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleRegister}>
            <div style={{ marginBottom: '12px' }}>
              <label className={labelClass}>Full Name</label>
              <input
                type="text"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="John Smith"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                className="block-input"
                style={{ width: '100%' }}
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div style={{ marginBottom: '20px' }}>
              <label className={labelClass}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="block-input"
                  style={{ width: '100%', paddingRight: '36px' }}
                  placeholder="Min. 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#6b6b6b', padding: '4px' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#6b6b6b', marginTop: '4px' }}>
                {password.length > 0 && password.length < 6 ? '⚠ Too short' : password.length >= 6 ? '✓ Good' : ''}
              </div>
            </div>
            <button
              type="submit"
              disabled={!displayName.trim() || !email.trim() || password.length < 6 || loading}
              className="block-btn-primary"
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: (!displayName.trim() || !email.trim() || password.length < 6 || loading) ? 0.5 : 1 }}
            >
              {loading ? 'Creating...' : 'Create Account'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          {hasExisting && (
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button onClick={() => { setMode(users.length > 1 ? 'pick-user' : 'login'); setError(''); }} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '13px', cursor: 'pointer' }}>
                ← Back to Sign In
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AuthScreen;
