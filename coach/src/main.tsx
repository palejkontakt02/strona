import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './auth/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import { applyPalette, getPalette } from './theme';

applyPalette(getPalette());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/app/sw.js', { scope: '/app/' }).catch(() => {
      // bez trybu offline — aplikacja działa normalnie
    });
  });
}
