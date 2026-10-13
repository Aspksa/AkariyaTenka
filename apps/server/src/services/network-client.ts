import { AppError, type AppErrorCode, type RequestContextScope } from "@akariya/core";

export interface NetworkRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly streamIdleTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly retries?: number;
}

interface NormalizedNetworkOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly streamIdleTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly retries: number;
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
    const normalized = this.normalize(options);
    let lastError: unknown;

    for (let attempt = 0; attempt <= normalized.retries; attempt += 1) {
      const attemptState = this.attemptSignal(normalized.signal, normalized.timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          headers: this.headers(init.headers),
          signal: attemptState.signal
        });
        this.rejectDeclaredOversize(response, normalized.maxResponseBytes);

        const retryableStatus = response.status === 429 || response.status >= 500;
        if (retryableStatus && attempt < normalized.retries) {
          await response.body?.cancel().catch(() => {});
          await this.backoff(attempt, normalized.signal);
          continue;
        }

        const buffered = await this.bufferWithinLimit(response, normalized.maxResponseBytes);
        this.rejectFinalStatus(buffered);
        return buffered;
      } catch (error) {
        lastError = error;
        if (
          error instanceof AppError
          || error instanceof ResponseTooLargeError
          || attempt >= normalized.retries
          || normalized.signal?.aborted
        ) break;
        await this.backoff(attempt, normalized.signal);
      } finally {
        attemptState.dispose();
      }
    }

    throw this.normalizeFailure(lastError);
  }

  async fetchStream(url: URL, init: RequestInit = {}, options: NetworkRequestOptions = {}): Promise<Response> {
    const normalized = this.normalize(options);
    let lastError: unknown;

    for (let attempt = 0; attempt <= normalized.retries; attempt += 1) {
      const attemptState = this.attemptSignal(normalized.signal, normalized.timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          headers: this.headers(init.headers),
          signal: attemptState.signal
        });
        this.rejectDeclaredOversize(response, normalized.maxResponseBytes);

        const retryableStatus = response.status === 429 || response.status >= 500;
        if (retryableStatus && attempt < normalized.retries) {
          await response.body?.cancel().catch(() => {});
          await this.backoff(attempt, normalized.signal);
          continue;
        }

        this.rejectFinalStatus(response);
        return this.wrapBoundedStream(
          response,
          normalized.maxResponseBytes,
          normalized.streamIdleTimeoutMs,
          normalized.signal
        );
      } catch (error) {
        lastError = error;
        if (
          error instanceof AppError
          || error instanceof ResponseTooLargeError
          || attempt >= normalized.retries
          || normalized.signal?.aborted
        ) break;
        await this.backoff(attempt, normalized.signal);
      } finally {
        attemptState.dispose();
      }
    }

    throw this.normalizeFailure(lastError);
  }

  private normalize(options: NetworkRequestOptions): NormalizedNetworkOptions {
    const retries = options.retries ?? 2;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const streamIdleTimeoutMs = options.streamIdleTimeoutMs ?? 30_000;
    const maxResponseBytes = options.maxResponseBytes ?? 5_000_000;

    if (!Number.isSafeInteger(retries) || retries < 0 || retries > 10) {
      throw this.error("VALIDATION", "retries must be an integer between 0 and 10");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw this.error("VALIDATION", "timeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(streamIdleTimeoutMs) || streamIdleTimeoutMs < 1) {
      throw this.error("VALIDATION", "streamIdleTimeoutMs must be a positive safe integer");
    }
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 0) {
      throw this.error("VALIDATION", "maxResponseBytes must be a non-negative safe integer");
    }

    return {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      retries,
      timeoutMs,
      streamIdleTimeoutMs,
      maxResponseBytes
    };
  }

  private headers(input?: HeadersInit): Headers {
    const headers = new Headers(input);
    const correlationId = this.requestContext?.current()?.correlationId;
    if (correlationId !== undefined && !headers.has("x-correlation-id")) {
      headers.set("x-correlation-id", correlationId);
    }
    return headers;
  }

  private attemptSignal(parent: AbortSignal | undefined, timeoutMs: number): {
    readonly signal: AbortSignal;
    dispose(): void;
  } {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("External request timed out")), timeoutMs);
    const abort = () => controller.abort(parent?.reason);
    if (parent?.aborted) controller.abort(parent.reason);
    else parent?.addEventListener("abort", abort, { once: true });

    return {
      signal: controller.signal,
      dispose: () => {
        clearTimeout(timeout);
        parent?.removeEventListener("abort", abort);
      }
    };
  }

  private rejectDeclaredOversize(response: Response, maxBytes: number): void {
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader === null) return;
    const length = Number(lengthHeader);
    if (Number.isFinite(length) && length > maxBytes) {
      void response.body?.cancel().catch(() => {});
      throw new ResponseTooLargeError();
    }
  }

  private rejectFinalStatus(response: Response): void {
    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      void response.body?.cancel().catch(() => {});
      throw this.error(
        "RATE_LIMIT",
        "External service rate limited the request",
        undefined,
        retryAfter === null ? undefined : { retryAfter }
      );
    }
    if (response.status >= 500) {
      void response.body?.cancel().catch(() => {});
      throw this.error("EXTERNAL_SERVICE", "External service returned HTTP " + response.status);
    }
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

  private wrapBoundedStream(
    response: Response,
    maxBytes: number,
    idleTimeoutMs: number,
    parent?: AbortSignal
  ): Response {
    if (!response.body) return response;
    const reader = response.body.getReader();
    let total = 0;
    let done = false;

    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (done) return;
        if (parent?.aborted) {
          done = true;
          await reader.cancel(parent.reason).catch(() => {});
          controller.error(parent.reason);
          return;
        }

        try {
          const next = await this.readWithIdleTimeout(reader, idleTimeoutMs, parent);
          if (next.done) {
            done = true;
            reader.releaseLock();
            controller.close();
            return;
          }

          total += next.value.byteLength;
          if (total > maxBytes) {
            done = true;
            await reader.cancel().catch(() => {});
            reader.releaseLock();
            controller.error(this.error(
              "EXTERNAL_SERVICE",
              "External response exceeds size limit",
              undefined,
              { kind: "response_too_large" }
            ));
            return;
          }
          controller.enqueue(next.value);
        } catch (error) {
          done = true;
          await reader.cancel(error).catch(() => {});
          reader.releaseLock();
          controller.error(error instanceof AppError ? error : this.error("EXTERNAL_SERVICE", "External stream failed", error));
        }
      },
      cancel: async (reason) => {
        done = true;
        await reader.cancel(reason).catch(() => {});
        try { reader.releaseLock(); } catch { /* already released */ }
      }
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }

  private readWithIdleTimeout(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    idleTimeoutMs: number,
    parent?: AbortSignal
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        parent?.removeEventListener("abort", onAbort);
        operation();
      };
      const onAbort = () => finish(() => reject(parent?.reason));
      const timer = setTimeout(
        () => finish(() => reject(this.error("EXTERNAL_SERVICE", "External stream idle timeout"))),
        idleTimeoutMs
      );
      parent?.addEventListener("abort", onAbort, { once: true });

      void reader.read().then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error))
      );
    });
  }

  private normalizeFailure(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof ResponseTooLargeError) {
      return this.error("EXTERNAL_SERVICE", error.message, error, { kind: "response_too_large" });
    }
    return this.error("EXTERNAL_SERVICE", "External request failed", error);
  }

  private async backoff(attempt: number, signal?: AbortSignal): Promise<void> {
    const delay = Math.min(250 * 2 ** attempt, 2_000);
    if (signal === undefined) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      return;
    }
    if (signal.aborted) throw signal.reason;

    const parent = signal;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        parent.removeEventListener("abort", onAbort);
        reject(parent.reason);
      };
      const timer = setTimeout(() => {
        parent.removeEventListener("abort", onAbort);
        resolve();
      }, delay);
      parent.addEventListener("abort", onAbort, { once: true });
    });
  }

  private error(
    code: AppErrorCode,
    message: string,
    cause?: unknown,
    details?: Readonly<Record<string, unknown>>
  ): AppError {
    const correlationId = this.requestContext?.current()?.correlationId;
    return new AppError({
      code,
      message,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(cause === undefined ? {} : { cause }),
      ...(details === undefined ? {} : { details })
    });
  }
}
