export interface VirtualWindowInput {
  readonly itemCount: number;
  readonly itemHeight: number;
  readonly viewportHeight: number;
  readonly scrollTop: number;
  readonly overscan?: number;
}

export interface VirtualWindow {
  readonly start: number;
  readonly end: number;
  readonly offsetTop: number;
  readonly totalHeight: number;
}

export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { itemCount, itemHeight, viewportHeight } = input;
  const overscan = input.overscan ?? 4;
  if (!Number.isSafeInteger(itemCount) || itemCount < 0) throw new Error("itemCount must be a non-negative integer");
  if (!Number.isFinite(itemHeight) || itemHeight <= 0) throw new Error("itemHeight must be positive");
  if (!Number.isFinite(viewportHeight) || viewportHeight < 0) throw new Error("viewportHeight must be non-negative");
  if (!Number.isSafeInteger(overscan) || overscan < 0) throw new Error("overscan must be a non-negative integer");

  const scrollTop = Math.max(0, Number.isFinite(input.scrollTop) ? input.scrollTop : 0);
  const visibleStart = Math.floor(scrollTop / itemHeight);
  const visibleCount = Math.ceil(viewportHeight / itemHeight);
  const start = Math.min(itemCount, Math.max(0, visibleStart - overscan));
  const end = Math.min(itemCount, visibleStart + visibleCount + overscan);

  return {
    start,
    end: Math.max(start, end),
    offsetTop: start * itemHeight,
    totalHeight: itemCount * itemHeight
  };
}
