export type FrameScheduler = (callback: FrameRequestCallback) => number;
export type FrameCanceller = (handle: number) => void;

export class FrameBatcher<T> {
  private scheduled: number | undefined;
  private latest: T | undefined;

  constructor(
    private readonly apply: (value: T) => void,
    private readonly schedule: FrameScheduler = (callback) => requestAnimationFrame(callback),
    private readonly cancelScheduled: FrameCanceller = (handle) => cancelAnimationFrame(handle)
  ) {}

  push(value: T): void {
    this.latest = value;
    if (this.scheduled !== undefined) return;
    this.scheduled = this.schedule(() => {
      this.scheduled = undefined;
      const current = this.latest;
      this.latest = undefined;
      if (current !== undefined) this.apply(current);
    });
  }

  flush(): void {
    if (this.scheduled !== undefined) {
      this.cancelScheduled(this.scheduled);
      this.scheduled = undefined;
    }
    const current = this.latest;
    this.latest = undefined;
    if (current !== undefined) this.apply(current);
  }

  cancel(): void {
    if (this.scheduled !== undefined) this.cancelScheduled(this.scheduled);
    this.scheduled = undefined;
    this.latest = undefined;
  }
}
