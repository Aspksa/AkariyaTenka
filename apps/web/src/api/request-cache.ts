interface CacheEntry<T> {
  readonly expiresAt: number;
  readonly value: T;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

async function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) throw abortError(signal);

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    void promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export class RequestCache {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async get<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error("ttlMs must be non-negative");
    const now = performance.now();
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    if (cached !== undefined && cached.expiresAt >= now) return cached.value;

    let shared = this.inFlight.get(key) as Promise<T> | undefined;
    if (shared === undefined) {
      shared = loader().then((value) => {
        this.cache.set(key, { expiresAt: performance.now() + ttlMs, value });
        return value;
      }).finally(() => {
        this.inFlight.delete(key);
      });
      this.inFlight.set(key, shared);
    }

    return await withSignal(shared, signal);
  }

  invalidate(key?: string): void {
    if (key === undefined) this.cache.clear();
    else this.cache.delete(key);
  }
}
