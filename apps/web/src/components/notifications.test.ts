import { describe, it, expect } from "vitest";
import { dayLabel, defaultNoticeSettings, isQuiet, noticeAllowed, parseNotices, parseNoticeSettings, relativeTime } from "./notifications.js";

describe("notification persistence", () => {
  it("accepts only bounded safe entries", () => {
    const valid = { id: "update:123", kind: "update", title: "New version", detail: "Ready", at: 100, read: false };
    expect(parseNotices([valid, { ...valid, kind: "script" }, { ...valid, title: "x".repeat(200) }, null])).toEqual([valid]);
    expect(parseNotices({})).toEqual([]);
    expect(parseNotices([{ ...valid, archived: true }, { ...valid, archived: "bad" }])).toEqual([{ ...valid, archived: true }]);
  });
  it("deduplicates persisted notices by stable event id", () => {
    const first = { id: "update:abc", kind: "update", title: "Available", detail: "Ready", at: 100, read: false };
    const newest = { ...first, detail: "Latest", at: 200 };
    expect(parseNotices([first, newest, first])).toEqual([first]);
    expect(parseNotices([first, newest])).toEqual([newest]);
  });
  it("validates notification preferences with safe defaults", () => {
    expect(parseNoticeSettings(null)).toEqual(defaultNoticeSettings);
    expect(parseNoticeSettings({ showUpdates: false, showErrors: "no", toasts: false, system: 1 })).toEqual({
      ...defaultNoticeSettings, showUpdates: false, toasts: false
    });
  });
  it("keeps settings saved by the previous version", () => {
    const old = { showUpdates: true, showErrors: false, showInfo: true, unreadOnly: true, sound: true, doNotDisturb: true,
      minimumPriority: "critical", retentionDays: 7, density: "compact", opacity: 70, fontScale: 115 };
    expect(parseNoticeSettings(old)).toEqual({ ...defaultNoticeSettings, showErrors: false, sound: true, doNotDisturb: true,
      minimumPriority: "critical", retentionDays: 7, density: "compact", opacity: 70, fontScale: 115 });
    expect(parseNoticeSettings({ sound: "yes", minimumPriority: "invalid", retentionDays: -1, density: "x", opacity: 14, fontScale: 800 }))
      .toMatchObject({ sound: false, minimumPriority: "all", retentionDays: 30, density: "expanded", opacity: 100, fontScale: 100 });
  });
});

describe("notification rules", () => {
  it("applies kind switches and the importance level", () => {
    const s = { ...defaultNoticeSettings };
    expect(noticeAllowed({ kind: "info" }, s)).toBe(true);
    expect(noticeAllowed({ kind: "info" }, { ...s, showInfo: false })).toBe(false);
    expect(noticeAllowed({ kind: "update" }, { ...s, minimumPriority: "important" })).toBe(true);
    expect(noticeAllowed({ kind: "info" }, { ...s, minimumPriority: "important" })).toBe(false);
    expect(noticeAllowed({ kind: "update" }, { ...s, minimumPriority: "critical" })).toBe(false);
    expect(noticeAllowed({ kind: "error" }, { ...s, minimumPriority: "critical" })).toBe(true);
  });
  it("is quiet with «Не беспокоить» or at night when quiet hours are on", () => {
    const s = { ...defaultNoticeSettings };
    expect(isQuiet(s, new Date(2026, 0, 1, 23))).toBe(false);
    expect(isQuiet({ ...s, doNotDisturb: true }, new Date(2026, 0, 1, 12))).toBe(true);
    expect(isQuiet({ ...s, quietHours: true }, new Date(2026, 0, 1, 23))).toBe(true);
    expect(isQuiet({ ...s, quietHours: true }, new Date(2026, 0, 1, 7, 59))).toBe(true);
    expect(isQuiet({ ...s, quietHours: true }, new Date(2026, 0, 1, 8))).toBe(false);
  });
  it("writes times the way people say them", () => {
    const now = new Date(2026, 9, 15, 15, 0).getTime();
    expect(relativeTime(now - 20_000, now)).toBe("только что");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 мин назад");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 ч назад");
    expect(relativeTime(new Date(2026, 9, 14, 9, 30).getTime(), now)).toBe("вчера, 09:30");
    expect(dayLabel(now, now)).toBe("Сегодня");
    expect(dayLabel(new Date(2026, 9, 14, 23).getTime(), now)).toBe("Вчера");
    expect(dayLabel(new Date(2026, 9, 1).getTime(), now)).toBe("1 октября");
  });
});
