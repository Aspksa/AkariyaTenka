import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkLatestRelease, compareVersions, downloadVerifiedRelease, parseChecksum, parseVersion } from "./update-manager.mjs";

const base = "https://github.com/Aspksa/AkariyaTenka/releases/download/v1.2.3/";
const payload = Buffer.from("akariya release fixture");
const sha = createHash("sha256").update(payload).digest("hex");
const release = {
  tag_name: "v1.2.3", draft: false, prerelease: false,
  assets: [
    { name: "AkariyaTenka.zip", browser_download_url: base + "AkariyaTenka.zip", size: payload.length },
    { name: "AkariyaTenka.zip.sha256", browser_download_url: base + "AkariyaTenka.zip.sha256", size: 85 }
  ]
};
function mockFetch({ checksum = sha, archive = payload, metadata = release, redirect = null } = {}) {
  return async (url) => {
    if (String(url).endsWith("/releases/latest")) return new Response(JSON.stringify(metadata));
    if (String(url).endsWith(".sha256")) return new Response(`${checksum}  AkariyaTenka.zip\n`);
    if (String(url).endsWith(".zip")) return redirect
      ? new Response(null, { status: 302, headers: { location: redirect } })
      : new Response(archive);
    throw new Error(`unexpected request ${url}`);
  };
}
test("semantic releases are compared without lexical version ordering", () => {
  assert.equal(compareVersions("v1.10.0", "v1.9.9"), 1);
  assert.equal(compareVersions("v1.0.0-rc.1", "v1.0.0"), -1);
  assert.throws(() => parseVersion("../bad"));
});
test("checksum parser rejects ambiguous manifests", () => {
  assert.equal(parseChecksum(`${sha}  AkariyaTenka.zip\n`), sha);
  assert.throws(() => parseChecksum(`${sha}  AkariyaTenka.zip\n${sha}  AkariyaTenka.zip\n`));
});
test("release discovery rejects assets on unapproved hosts", async () => {
  const bad = structuredClone(release);
  bad.assets[0].browser_download_url = "https://example.com/evil.zip";
  await assert.rejects(checkLatestRelease({ fetchImpl: mockFetch({ metadata: bad }) }), /Untrusted/);
});
test("valid download verifies digest and keeps installer untouched", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-download-"));
  try {
    const selected = await checkLatestRelease({ fetchImpl: mockFetch() });
    const result = await downloadVerifiedRelease({ release: selected, updatesDir: root, fetchImpl: mockFetch() });
    assert.deepEqual(await readFile(result.file), payload);
    assert.equal(result.sha256, sha);
    await assert.rejects(readFile(path.join(root, "ready.json")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("bad checksum fails closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-download-"));
  try {
    const selected = await checkLatestRelease({ fetchImpl: mockFetch() });
    await assert.rejects(downloadVerifiedRelease({
      release: selected, updatesDir: root, fetchImpl: mockFetch({ checksum: "0".repeat(64) })
    }), /checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("untrusted redirect target is rejected before following", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "akariya-download-"));
  try {
    const selected = await checkLatestRelease({ fetchImpl: mockFetch() });
    await assert.rejects(downloadVerifiedRelease({
      release: selected, updatesDir: root, fetchImpl: mockFetch({ redirect: "https://evil.example/download" })
    }), /Untrusted/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
