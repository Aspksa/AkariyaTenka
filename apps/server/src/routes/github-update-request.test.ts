import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { AppError } from "@akariya/core";
import { createGithubUpdateRequest } from "./github-update-request.js";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

function mainSequence(...shas: string[]): typeof fetch {
  let index = 0;
  return (async (url: string) => {
    if (url.includes("/compare/")) return new Response(JSON.stringify({ commits: [] }), { status: 200 });
    const sha = shas[Math.min(index++, shas.length - 1)];
    return new Response(JSON.stringify({ sha }), { status: 200 });
  }) as typeof fetch;
}

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "akariya-update-request-"));
  try {
    await writeFile(path.join(root, ".akariya-version"), A + "\n");
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe("GitHub update request", () => {
  it("accepts the reviewed latest main revision", async () => {
    await withRoot(async root => {
      await createGithubUpdateRequest(root, mainSequence(B), 0)({ sha: B });
      const saved = await readFile(path.join(root, ".runtime", "github-updater", "request.json"), "utf8");
      expect(JSON.parse(saved)).toEqual({ sha: B });
    });
  });

  it("re-checks once when a GitHub replica still reports the previous main", async () => {
    await withRoot(async root => {
      await expect(createGithubUpdateRequest(root, mainSequence(A, B), 0)({ sha: B }))
        .resolves.toContain(B);
    });
  });

  it("reports a conflict, not an internal error, when main moved after the review", async () => {
    await withRoot(async root => {
      const result = createGithubUpdateRequest(root, mainSequence(C), 0)({ sha: B });
      await expect(result).rejects.toBeInstanceOf(AppError);
      await expect(result).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  it("rejects malformed revisions as validation errors", async () => {
    await withRoot(async root => {
      await expect(createGithubUpdateRequest(root, mainSequence(B), 0)({ sha: "../main" }))
        .rejects.toMatchObject({ code: "VALIDATION" });
    });
  });
});
