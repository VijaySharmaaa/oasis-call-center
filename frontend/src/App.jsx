import { useState, useEffect, useRef } from 'react';
import { useAuth } from './contexts/AuthContext';
import { PageChromeProvider } from './contexts/PageChromeContext';
import Sidebar        from './components/Sidebar';
import Login          from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard      from './pages/Dashboard';
import CallReport     from './pages/CallReport';
import Agents         from './pages/Agents';
import Tickets        from './pages/Tickets';
import Emails         from './pages/Emails';
import AIAnalysis     from './pages/AIAnalysis';
import Stations       from './pages/Stations';
import Reports        from './pages/Reports';

const VALID_PAGES = new Set(['dashboard', 'call-report', 'agents', 'tickets', 'emails', 'ai-analysis', 'stations', 'reports']);

function pageFromPath() {
  const seg = window.location.pathname.replace(/^\//, '');
  return VALID_PAGES.has(seg) ? seg : 'dashboard';
}

function Shell() {
  const { user, loading, mustChangePassword, sessionExpired, logout } = useAuth();
  const [activePage, setActivePage] = useState(pageFromPath);
  const intendedPage = useRef(null);

  function navigate(page) {
    const path = page === 'dashboard' ? '/' : `/${page}`;
    window.history.pushState({}, '', path);
    setActivePage(page);
  }

  useEffect(() => {
    function onPopState() {
      setActivePage(pageFromPath());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // When not logged in, save the intended destination and clean the URL to "/"
  useEffect(() => {
    if (!loading && !user) {
      const page = pageFromPath();
      intendedPage.current = page !== 'dashboard' ? page : null;
      window.history.replaceState({}, '', '/');
    }
  }, [loading, user]);

  // After login, navigate to the originally intended page
  const prevUser = useRef(null);
  useEffect(() => {
    if (user && !prevUser.current && intendedPage.current) {
      navigate(intendedPage.current);
      intendedPage.current = null;
    }
    prevUser.current = user;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Login />;
  if (mustChangePassword) return <ChangePassword />;

  function renderPage() {
    switch (activePage) {
      case 'call-report':  return <CallReport />;
      case 'agents':       return <Agents />;
      case 'tickets':      return <Tickets />;
      case 'emails':       return <Emails />;
      case 'ai-analysis':  return <AIAnalysis />;
      case 'stations':     return <Stations />;
      case 'reports':      return <Reports />;
      default:             return <Dashboard onNavigate={navigate} />;
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-zinc-950 text-slate-900 dark:text-zinc-100 flex flex-col">
      {sessionExpired && (
        <div className="print:hidden z-50 flex items-center justify-between gap-4 px-4 py-2.5 bg-amber-500 text-white text-sm shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="6"/><path d="M8 5v3M8 11h.01"/>
            </svg>
            <span>Your session has expired. You can continue viewing, but please sign in again when your current call ends.</span>
          </div>
          <button
            onClick={logout}
            className="shrink-0 px-3 py-1 rounded-md bg-white/20 hover:bg-white/30 text-white text-xs font-medium transition-colors"
          >
            Sign in again
          </button>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Chrome is screen-only: a printed report is the sheets and nothing else. */}
        <div className="print:hidden contents">
          <Sidebar activePage={activePage} onNavigate={navigate} />
        </div>
        <main className="flex-1 min-w-0 pt-14 lg:pt-0 overflow-auto">
          {/* Keyed by page so a page's registered loader and any stale filter
              state cannot leak into the next one on navigation. The date range
              itself lives above this, in the provider, and is meant to carry
              across pages. */}
          <div key={activePage} className="contents">
            {renderPage()}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <PageChromeProvider>
      <Shell />
    </PageChromeProvider>
  );
}
