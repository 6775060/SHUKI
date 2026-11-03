import type { StudioApi, StudioEvent } from '../../main/api';

type CallResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

declare global {
  interface Window {
    studio: {
      call(method: string, ...args: unknown[]): Promise<CallResult>;
      pickFolder(): Promise<string | null>;
      reveal(path: string): Promise<boolean>;
      onEvent(cb: (e: StudioEvent) => void): () => void;
    };
  }
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };

/** Typed proxy: api.listSites() → ipc "studio:call" → Studio.listSites() in the main process. */
export const api = new Proxy({} as Async<StudioApi>, {
  get: (_t, method: string) => async (...args: unknown[]) => {
    const r = await window.studio.call(method, ...args);
    if (!r.ok) throw new ApiError(r.error.code, r.error.message);
    return r.value;
  },
});
