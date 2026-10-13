import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "./index.js";

describe("contracts", () => {
  it("rejects malformed health responses at runtime", () => {
    expect(healthResponseSchema.safeParse({ status: "healthy" }).success).toBe(false);
  });
});
