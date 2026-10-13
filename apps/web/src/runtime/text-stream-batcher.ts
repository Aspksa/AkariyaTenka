import { FrameBatcher, type FrameCanceller, type FrameScheduler } from "./frame-batcher.js";

export class TextStreamBatcher {
  private pending = "";
  private readonly frames: FrameBatcher<string>;

  constructor(
    append: (chunk: string) => void,
    schedule?: FrameScheduler,
    cancelScheduled?: FrameCanceller
  ) {
    this.frames = new FrameBatcher(
      (marker) => {
        void marker;
        const chunk = this.pending;
        this.pending = "";
        if (chunk) append(chunk);
      },
      schedule,
      cancelScheduled
    );
  }

  push(chunk: string): void {
    if (!chunk) return;
    this.pending += chunk;
    this.frames.push("pending");
  }

  flush(): void {
    this.frames.flush();
  }

  cancel(): void {
    this.pending = "";
    this.frames.cancel();
  }
}
