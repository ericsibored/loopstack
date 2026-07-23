import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Dynamic import so the dev-only virtual mic is code-split out of the
// production bundle entirely rather than merely unused within it.
if (import.meta.env.DEV) {
  void import('./dev/virtualMic').then((m) => m.install());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
