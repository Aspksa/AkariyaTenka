import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { canonicalReleasePayload } from "../../../../scripts/release-trust.mjs";
import { createVerifiedUpdateRoute, verifyPublisherManifest } from "./update-verify.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const trust = {
  publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  spkiSha256: createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex")
};
const metadata = {
  schemaVersion: 1, repository: "Aspksa/AkariyaTenka", tag: "v1.2.3",
  sourceSha: "a".repeat(40), archiveSha256: "b".repeat(64), archiveSize: 1024
};
const signature = sign(null, canonicalReleasePayload(metadata), privateKey).toString("base64") + "\n";
const prefix = "https://github.com/Aspksa/AkariyaTenka/releases/download/";

function api({ assetTag = "v1.2.3", altered = false, missing = false } = {}) {
  const assets = ["AkariyaTenka.release.json", ...missing ? [] : ["AkariyaTenka.release.sig"]].map(name => ({
    name, browser_download_url: prefix + assetTag + "/" + name
  }));
  const release = { tag_name: "v1.2.3", draft: false, prerelease: false, assets };
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/releases/latest")) return new Response(JSON.stringify(release));
    if (url.endsWith(".release.json")) return new Response(JSON.stringify(altered ? { ...metadata, archiveSize: 1 } : metadata));
    if (url.endsWith(".release.sig")) return new Response(signature);
    throw new Error("Unexpected request");
  };
  return fetchImpl;
}

describe("signed update verification API", () => {
  it("fails closed without an embedded trust anchor, without network activity", async () => {
    let called = false;
    const route = createVerifiedUpdateRoute(null, async () => { called = true; throw Error("network"); });
    const result = JSON.parse(await route());
    expect(result.status).toBe("not_configured");
    expect(result.installationEnabled).toBe(false);
    expect(called).toBe(false);
  });
  it("authenticates a correctly signed manifest but keeps installation disabled", async () => {
    const result = JSON.parse(await createVerifiedUpdateRoute(trust, api())());
    expect(result.status).toBe("verified");
    expect(result.verified).toBe(true);
    expect(result.installationEnabled).toBe(false);
  });
  it("rejects altered metadata, wrong key, missing asset and assets from a different tag", async () => {
    for (const [pinned, options] of [
      [trust, { altered: true }],
      [{ ...trust, spkiSha256: "0".repeat(64) }, {}],
      [trust, { missing: true }],
      [trust, { assetTag: "v1.2.2" }]
    ] as const) {
      const result = JSON.parse(await createVerifiedUpdateRoute(pinned, api(options))());
      expect(result.status).toBe("failed");
      expect(result.installationEnabled).toBe(false);
    }
  });
  it("rejects replayed or mutated payloads", () => {
    expect(() => verifyPublisherManifest({ ...metadata, tag: "v1.2.4" }, signature, trust)).toThrow();
    expect(() => verifyPublisherManifest(metadata, signature, { ...trust, spkiSha256: "0".repeat(64) })).toThrow();
  });
});
