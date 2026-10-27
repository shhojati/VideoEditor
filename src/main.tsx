import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import { App } from './app/App';
import { initAccount } from './store/account';
import { initAgent } from './features/agent/bridge';

if (import.meta.env.DEV) {
  // Handles for debugging and E2E checks; not present in production builds.
  void Promise.all([import('./store/transport'), import('./store/projectStore')]).then(([t, p]) => {
    Object.assign(window, { __stores: { transport: t.useTransport, project: p.useProjectStore } });
  });
}

initAccount();
initAgent();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
