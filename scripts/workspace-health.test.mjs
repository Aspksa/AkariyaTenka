import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AKARIYA_WORKSPACES, inspectWorkspaceLinks, missingWorkspaceLinks } from "./workspace-health.mjs";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "akariya-workspaces-"));
  for (const [name, relativeSource] of AKARIYA_WORKSPACES) {
    const source = path.join(root, relativeSource);
    mkdirSync(source, { recursive: true });
    writeFileSync(path.join(source, "package.json"), JSON.stringify({ name }));
  }
  return root;
}

function linkAll(root) {
  for (const [name, relativeSource] of AKARIYA_WORKSPACES) {
    const link = path.join(root, "node_modules", ...name.split("/"));
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(path.join(root, relativeSource), link, process.platform === "win32" ? "junction" : "dir");
  }
}

test("detects missing npm workspace links", () => {
  const root = fixture();
  try {
    assert.deepEqual(missingWorkspaceLinks(root), AKARIYA_WORKSPACES.map(([name]) => name));
    linkAll(root);
    assert.deepEqual(missingWorkspaceLinks(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detects a workspace link that targets the wrong package", () => {
  const root = fixture();
  try {
    linkAll(root);
    const link = path.join(root, "node_modules", "@akariya", "core");
    unlinkSync(link);
    symlinkSync(path.join(root, "packages", "contracts"), link, process.platform === "win32" ? "junction" : "dir");
    const problem = inspectWorkspaceLinks(root).find((item) => item.name === "@akariya/core");
    assert.equal(problem?.ok, false);
    assert.equal(problem?.reason, "workspace-package-name-mismatch");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("detects a corrupted workspace package manifest", () => {
  const root = fixture();
  try {
    linkAll(root);
    writeFileSync(path.join(root, "packages", "security", "package.json"), "{broken");
    const problem = inspectWorkspaceLinks(root).find((item) => item.name === "@akariya/security");
    assert.equal(problem?.ok, false);
    assert.equal(problem?.reason, "workspace-link-unreadable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
