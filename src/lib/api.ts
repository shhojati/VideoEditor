// Client for the account API (server/), same-origin under /api.

/** `code` matches the server's error codes (server/src/app.ts), plus 'network' when unreachable. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = (await r.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!r.ok || !data) throw new ApiError(r.status, data?.error ?? (r.status >= 500 || !data ? 'network' : 'bad_request'));
  return data;
}

export type Plan = 'free' | 'pro';

export interface Me {
  id: number;
  code: string;
  email: string;
  isAdmin: boolean;
  plan: Plan;
  /** Unix ms; may be in the past (expired pass). */
  proUntil: number | null;
}

export interface AdminUser extends Me {
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Grant {
  id: number;
  userId: number;
  code: string;
  email: string;
  /** 0 = revoked. */
  months: number;
  amountToman: number;
  note: string;
  proUntil: number | null;
  createdAt: number;
}
