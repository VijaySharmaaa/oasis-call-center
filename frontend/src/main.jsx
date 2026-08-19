import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

// Open date picker on click anywhere on the input (since native icon is hidden)
document.addEventListener('click', e => {
  if (e.target?.type === 'date' && e.target.showPicker) {
    try { e.target.showPicker(); } catch {}
  }
});

/**
 * The portal has one look. Anything that still says `dark:` is inert — but only
 * while the class is genuinely gone, and a class already on the element outlives
 * the code that put it there. Strip it once, at boot, so a stale one from an
 * older session cannot half-invert the page.
 */
document.documentElement.classList.remove('dark');

import App from './App.jsx'
import { AuthProvider } from './contexts/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
