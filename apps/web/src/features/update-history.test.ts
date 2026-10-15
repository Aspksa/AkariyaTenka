import { describe, expect, it } from "vitest";
import { durationText, groupAttempts, type HistoryEvent } from "./update-history.js";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const t = (min: number): string => new Date(Date.UTC(2026, 9, 15, 10, min)).toISOString();
const ev = (min: number, event: string, revision: string | null): HistoryEvent => ({ at: t(min), event, revision });
const now = Date.UTC(2026, 9, 15, 12, 0);

describe("история обновлений", () => {
  it("joins journal steps into attempts with their outcome and versions", () => {
    const events = [
      ev(0, "download_started", A), ev(1, "validated", A), ev(2, "prepared", A), ev(3, "confirmed", A),
      ev(10, "download_started", B), ev(11, "validated", B), ev(12, "prepared", B), ev(13, "rolled_back", B),
      ev(20, "prepared", A), ev(21, "confirmed", A),
      ev(30, "download_started", C), ev(31, "failed", C)
    ].reverse();
    const attempts = groupAttempts(events, now);
    expect(attempts.map((a) => [a.kind, a.outcome, a.revision, a.from])).toEqual([
      ["install", "failed", C, A],
      ["restore", "restored", A, A],
      ["install", "rolled_back", B, A],
      ["install", "installed", A, null]
    ]);
    expect(attempts[3]!.endedAt - attempts[3]!.startedAt).toBe(3 * 60_000);
    expect(attempts[2]!.events).toHaveLength(4);
  });
  it("tells a running attempt from an interrupted one", () => {
    const fresh = groupAttempts([ev(115, "validated", A), ev(114, "download_started", A)], now);
    expect(fresh[0]!.outcome).toBe("running");
    const old = groupAttempts([ev(1, "download_started", A)], now);
    expect(old[0]!.outcome).toBe("interrupted");
  });
  it("keeps a rollback recorded after a restart with its attempt", () => {
    const attempts = groupAttempts([ev(0, "download_started", B), ev(1, "prepared", B), ev(5, "rolled_back", null)].reverse(), now);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.outcome).toBe("rolled_back");
  });
  it("writes durations briefly", () => {
    expect(durationText(8_000)).toBe("8 с");
    expect(durationText(72_000)).toBe("1 мин 12 с");
    expect(durationText(120_000)).toBe("2 мин");
    expect(durationText(3_900_000)).toBe("1 ч 5 мин");
  });
});
