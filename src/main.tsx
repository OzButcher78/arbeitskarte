import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LocaleProvider } from './i18n/locale';
import './index.css';
import App from './App';

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
