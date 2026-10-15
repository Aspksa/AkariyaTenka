import { describe, it, expect } from "vitest";
import { animatableNumber, percentIn, weeklyTotals } from "./project-insights.js";

describe("insight number animation", () => {
 it("animates plain and grouped integers with their suffix", () => {
  expect(animatableNumber("1 234 строк")).toEqual({ target: 1234, decimals: 0, separator: ",", suffix: " строк" });
  expect(animatableNumber("42")).toEqual({ target: 42, decimals: 0, separator: ",", suffix: "" });
 });
 it("keeps decimals and their separator", () => {
  expect(animatableNumber("12.34 МиБ/с")).toEqual({ target: 12.34, decimals: 2, separator: ".", suffix: " МиБ/с" });
  expect(animatableNumber("92,5%")).toEqual({ target: 92.5, decimals: 1, separator: ",", suffix: "%" });
 });
 it("never animates dates, hashes or paths", () => {
  expect(animatableNumber("2026-01-05 — +300 строк")).toBeNull();
  expect(animatableNumber("05.01.2026")).toBeNull();
  expect(animatableNumber("a1b2c3 — 12 файлов")).toBeNull();
  expect(animatableNumber("Нет данных")).toBeNull();
 });
 it("extracts the first percentage for mini rings", () => {
  expect(percentIn("108 строк (0.9%)")).toBe(0.9);
  expect(percentIn("92,5%")).toBe(92.5);
  expect(percentIn("1 234 строк")).toBeNull();
  expect(percentIn("140%")).toBeNull();
 });
 it("sums a Monday-aligned daily series into weeks", () => {
  const days = Array.from({ length: 10 }, (_, i) => ({ date: "2026-01-" + String(5 + i).padStart(2, "0"), commits: i }));
  expect(weeklyTotals(days)).toEqual([{ start: "2026-01-05", commits: 21 }, { start: "2026-01-12", commits: 24 }]);
 });
});
