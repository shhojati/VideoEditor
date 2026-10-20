// Minimal typed request/response over postMessage. Each handler returns { result, transfer? }.

type Handlers = Record<string, (args: never) => Promise<unknown>>;

interface Request {
  id: number;
  method: string;
  args: unknown;
}
type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

export interface WithTransfer<T> {
  result: T;
  transfer?: Transferable[];
}

/** Worker side. */
export function exposeRpc<H extends Record<string, (args: never) => Promise<WithTransfer<unknown>>>>(handlers: H) {
  self.onmessage = async (e: MessageEvent<Request>) => {
    const { id, method, args } = e.data;
    try {
      const fn = handlers[method];
      if (!fn) throw new Error(`Unknown method ${method}`);
      const { result, transfer = [] } = await fn(args as never);
      (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies Response, transfer);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      (self as unknown as Worker).postMessage({ id, ok: false, error } satisfies Response);
    }
  };
}

export type ClientOf<H> = {
  [K in keyof H]: H[K] extends (args: infer A) => Promise<WithTransfer<infer R>> ? (args: A) => Promise<R> : never;
};

/** Main-thread side. */
export function rpcClient<H extends Handlers>(worker: Worker): ClientOf<H> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  worker.onmessage = (e: MessageEvent<Response>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result);
    else p.reject(new Error(e.data.error));
  };
  return new Proxy({} as ClientOf<H>, {
    get: (_, method: string) => (args: unknown) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, method, args } satisfies Request);
      }),
  });
}
