import { describe, expect, it } from "vitest";
import { updateOutcome, updateProgress, type UpdateEvent } from "./update-progress.js";

const target = "a".repeat(40);
const other = "b".repeat(40);
const started = Date.parse("2026-10-14T07:30:00.000Z");

const record = (event: string, at: string, revision: string | null = target): UpdateEvent => ({
  event, at, revision
});

describe("one-click update status", () => {
  it("ignores a previous confirmation of the same revision", () => {
    expect(updateOutcome([record("confirmed", "2026-10-14T07:20:00.000Z")], target, started)).toBeNull();
  });
  it("ignores another revision and untrusted events", () => {
    expect(updateOutcome([
      record("confirmed", "2026-10-14T07:31:00.000Z", other),
      record("prepared", "2026-10-14T07:31:30.000Z")
    ], target, started)).toBeNull();
  });
  it("detects successful installation after current button press", () => {
    expect(updateOutcome([
      record("download_started", "2026-10-14T07:30:01.000Z"),
      record("confirmed", "2026-10-14T07:32:00.000Z")
    ], target, started)).toBe("confirmed");
  });
  it("prioritizes the most recent rollback over earlier failed events", () => {
    expect(updateOutcome([
      record("failed", "2026-10-14T07:31:00.000Z"),
      record("rolled_back", "2026-10-14T07:32:00.000Z")
    ], target, started)).toBe("rolled_back");
  });
  it("shows installation phase without falsely declaring success", () => {
    expect(updateProgress([
      record("download_started", "2026-10-14T07:30:01.000Z"),
      record("validated", "2026-10-14T07:31:00.000Z"),
      record("prepared", "2026-10-14T07:32:00.000Z")
    ], target, started)).toMatch(/перезапускается/);
    expect(updateOutcome([record("prepared", "2026-10-14T07:32:00.000Z")], target, started)).toBeNull();
  });
});
