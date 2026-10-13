export interface Clock {
  now(): Date;
  nowMs(): number;
}

export class SystemClock implements Clock {
  now(): Date { return new Date(); }
  nowMs(): number { return Date.now(); }
}
