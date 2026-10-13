import { AppError } from "@akariya/core";

export interface NetworkRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly retries?: number;
}

export class NetworkClient {
  async fetch(url: URL, init: RequestInit = {}, options: NetworkRequestOptions = {}): Promise<Response> {
    const retries = options.retries ?? 2;
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > (options.maxResponseBytes ?? 5_000_000)) {
          throw new AppError({ code: "EXTERNAL_SERVICE", message: "External response exceeds size limit" });
        }
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          await this.backoff(attempt, options.signal);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= retries || options.signal?.aborted) break;
        await this.backoff(attempt, options.signal);
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      }
    }
    throw new AppError({ code: "EXTERNAL_SERVICE", message: "External request failed", cause: lastError });
  }

  private async backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    const delay = Math.min(250 * 2 ** attempt, 2_000);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  }
}
