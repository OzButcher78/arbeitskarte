import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LocaleProvider } from './i18n/locale';
import { primeCapacitorCredentials } from './platform/credentials';
import { CREDENTIAL_STORE_KEYS } from './platform/credentialStore';
// Inter Variable, bundled locally (weight axis only) — the app must render
// correctly in airplane mode, so no CDN font. See the note in index.css for why
// this import lives here and not in the stylesheet.
import '@fontsource-variable/inter/wght.css';
import './index.css';
import App from './App';

// Android only: warm the credential cache so getDocScanKey() returns the real
// value synchronously. No-op on Electron (preload snapshot) and browser.
void primeCapacitorCredentials([...CREDENTIAL_STORE_KEYS]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Boot splash dismissal — wait for React's first commit to paint, then fade.
{
  const splash = document.getElementById('boot-splash');
  if (splash) {
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      splash.classList.add('boot-splash-fading');
      setTimeout(() => splash.remove(), 320);
    };
    requestAnimationFrame(() => requestAnimationFrame(dismiss));
    setTimeout(dismiss, 6000);
  }
}
