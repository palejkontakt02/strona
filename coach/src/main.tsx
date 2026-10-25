import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './auth/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
// warstwy designu (kolejność ma znaczenie: fundamenty, potem obszary)
import './styles/foundation.css';
import './styles/shell.css';
import './styles/client.css';
import './styles/tables.css';
import './styles/athlete.css';
import './styles/habits.css';
import './styles/rodo.css';
import './styles/progress.css';
import './styles/player.css';
import { applyPalette, getPalette, hasOwnPalette, systemPalette } from './theme';

applyPalette(getPalette());
// motyw domyślny podąża za trybem jasny / ciemny telefonu (dopóki ktoś nie wybierze motywu sam)
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!hasOwnPalette()) applyPalette(systemPalette());
  });
} catch {
  // starsze przeglądarki — motyw ustawiony przy starcie
}

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
