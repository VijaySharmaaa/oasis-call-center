import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import skyline from '../assets/india-skyline.webp';

const API = import.meta.env.VITE_API_URL ?? '';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Login failed'); return; }
      login(data.token, data.user, data.must_change_password ?? false);
    } catch {
      setError('Cannot connect to server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f5eee1] flex items-center justify-center p-4">
      {/* A warm wash behind the card, in the highlight colour rather than the
          old indigo — enough to lift the beige, not enough to tint the form. */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-indigo-500/15 rounded-full blur-3xl" />

        {/* The skyline stands ON the floor of the page: pinned to the bottom,
            full width, and capped so a tall viewport does not blow the linework
            up. Its field (#efe8db) is a shade off the page beige, which at a
            hard top edge would read as a band — hence the mask, which dissolves
            the top quarter into the page whatever height the image lands at.
            Hidden below `sm`, where a phone-width crop leaves two monuments and
            reads as stray texture rather than a skyline. */}
        <img
          src={skyline}
          alt=""
          aria-hidden="true"
          className="hidden sm:block absolute bottom-0 left-0 w-full max-h-[45vh] object-cover object-bottom select-none"
          style={{
            maskImage:       'linear-gradient(to bottom, transparent 0%, #000 30%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 30%)',
          }}
        />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-indigo-600/30">
            {/* A headset, not a handset: the people signing in answer mail
                and tickets as well as calls. */}
            <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0118 0"/>
              <path d="M3 12v4a2 2 0 002 2h1a1 1 0 001-1v-4a1 1 0 00-1-1H3z"/>
              <path d="M21 12v4a2 2 0 01-2 2h-1a1 1 0 01-1-1v-4a1 1 0 011-1h3z"/>
              <path d="M21 17v1a3 3 0 01-3 3h-4"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-black tracking-tight">OASIS</h1>
          <p className="text-sm text-slate-600 mt-1.5">Call Centre Management</p>
        </div>

        {/* Card */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-7 shadow-xl shadow-slate-300/40">
          <h2 className="text-base font-semibold text-black mb-6">Sign in to your account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Username / Agent Number
              </label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="5" r="3"/><path d="M1 14a7 7 0 0114 0"/>
                </svg>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin or agent number"
                  required
                  autoFocus
                  autoComplete="username"
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-black placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">
                Password
              </label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="7" width="10" height="8" rx="1.5"/><path d="M5 7V5a3 3 0 016 0v2"/>
                </svg>
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="w-full pl-9 pr-10 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-black placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? (
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13.5 8c0 .5-.1 1-.3 1.5M8 3C4.5 3 1.5 5.5 1 8c.2.8.6 1.5 1 2.2M3 3l10 10"/>
                      <path d="M6.5 6.6A2 2 0 0110 9.5"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 8C2.5 4.5 5 3 8 3s5.5 1.5 7 5c-1.5 3.5-4 5-7 5S2.5 11.5 1 8z"/>
                      <circle cx="8" cy="8" r="2"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 11h.01"/>
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full py-2.5 mt-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors shadow-lg shadow-indigo-600/25"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">OASIS · Call Centre Dashboard</p>
      </div>
    </div>
  );
}
