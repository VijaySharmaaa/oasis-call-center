import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL ?? '';

function EyeIcon({ open }) {
  return open ? (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 8c0 .5-.1 1-.3 1.5M8 3C4.5 3 1.5 5.5 1 8c.2.8.6 1.5 1 2.2M3 3l10 10"/>
      <path d="M6.5 6.6A2 2 0 0110 9.5"/>
    </svg>
  ) : (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 8C2.5 4.5 5 3 8 3s5.5 1.5 7 5c-1.5 3.5-4 5-7 5S2.5 11.5 1 8z"/>
      <circle cx="8" cy="8" r="2"/>
    </svg>
  );
}

function PasswordInput({ value, onChange, placeholder, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="7" width="10" height="8" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/>
      </svg>
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required
        autoFocus={autoFocus}
        className="w-full pl-9 pr-10 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-black placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
      >
        <EyeIcon open={show} />
      </button>
    </div>
  );
}

export default function ChangePassword() {
  const { token, user, clearMustChangePassword, logout } = useAuth();
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) { setError('Passwords do not match'); return; }
    if (newPassword.length < 6) { setError('Password must be at least 6 characters'); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to change password'); return; }
      clearMustChangePassword();
    } catch {
      setError('Cannot connect to server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5eee1] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-amber-600/8 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-amber-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-amber-500/30">
            <svg className="w-7 h-7 text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="7" width="10" height="8" rx="1.5"/>
              <path d="M5 7V5a3 3 0 016 0v2"/>
              <circle cx="8" cy="11" r="1"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-black">Set New Password</h1>
          <p className="text-sm text-slate-600 mt-1.5">
            Welcome, <span className="font-medium text-black">{user?.name}</span>. Please set a new password to continue.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-7 shadow-xl shadow-slate-300/40">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">New Password</label>
              <PasswordInput
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">Confirm Password</label>
              <PasswordInput
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 11h.01"/>
                </svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword}
              className="w-full py-2.5 mt-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/20"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                  </svg>
                  Saving…
                </span>
              ) : 'Set Password & Continue'}
            </button>

            <button
              type="button"
              onClick={logout}
              className="w-full py-2 text-xs text-slate-500 hover:text-black transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
