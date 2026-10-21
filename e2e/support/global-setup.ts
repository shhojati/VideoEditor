import type { FullConfig } from '@playwright/test';
import { setupAccount } from './account';

export default (config: FullConfig) => setupAccount(config, Number(process.env.E2E_API_PORT));
