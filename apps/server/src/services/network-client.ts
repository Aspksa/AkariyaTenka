import { AppError, type RequestContextScope } from "@akariya/core";

export interface NetworkRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly retries?: number;
}

class ResponseTooLargeError extends Error {
  constructor() {
    super("External response exceeds size limit");
    this.name = "ResponseTooLargeError";
  }
}

export class NetworkClient {
  constructor(private readonly requestContext?: RequestContextScope) {}

  async fetch(url: URL, init: RequestInit = {}, options: NetworkRequestOptions = {}): Promise<Response> {
    const retries = options.retries ?? 2;
    const maxResponseBytes = options.maxResponseBytes ?? 5_000_000;
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
      throw new AppError({ code: "VALIDATION", message: "maxResponseBytes must be a non-negative safe integer" });
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("External request timed out")), options.timeoutMs ?? 10_000);
      const abort = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) controller.abort(options.signal.reason);
      else options.signal?.addEventListener("abort", abort, { once: true });

      try {
        const headers = new Headers(init.headers);
        const correlationId = this.requestContext?.current()?.correlationId;
        if (correlationId !== undefined && !headers.has("x-correlation-id")) {
          headers.set("x-correlation-id", correlationId);
        }
        const response = await fetch(url, { ...init, headers, signal: controller.signal });
        const lengthHeader = response.headers.get("content-length");
        if (lengthHeader !== null) {
          const length = Number(lengthHeader);
          if (Number.isFinite(length) && length > maxResponseBytes) throw new ResponseTooLargeError();
        }

        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          await response.body?.cancel().catch(() => {});
          await this.backoff(attempt, options.signal);
          continue;
        }

        return await this.bufferWithinLimit(response, maxResponseBytes);
      } catch (error) {
        lastError = error;
        if (error instanceof ResponseTooLargeError || attempt >= retries || options.signal?.aborted) break;
        await this.backoff(attempt, options.signal);
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      }
    }

    if (lastError instanceof ResponseTooLargeError) {
      throw new AppError({ code: "EXTERNAL_SERVICE", message: lastError.message, cause: lastError });
    }
    throw new AppError({ code: "EXTERNAL_SERVICE", message: "External request failed", cause: lastError });
  }

  private async bufferWithinLimit(response: Response, maxBytes: number): Promise<Response> {
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new ResponseTooLargeError();
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }

    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }

  private async backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason;
    const delay = Math.min(250 * 2 ** attempt, 2_000);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delay);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}
