// Owner's admin page (/admin.html): find accounts, activate or end Pro, reset passwords.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../i18n';
import '../index.css';
import { loadAccount } from '../store/account';
import { AdminApp } from './AdminApp';

void loadAccount();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
