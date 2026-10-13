import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditSink } from "./audit.js";
import { InMemoryAuditSink, ApprovalGate, SecurePathResolver } from "./index.js";

class ToggleAuditSink implements AuditSink {
  fail = false;
  readonly events: AuditEvent[] = [];

  async emit(event: AuditEvent): Promise<void> {
    if (this.fail) throw new Error("audit unavailable");
    this.events.push(structuredClone(event));
  }
}

describe("approval gate", () => {
  it("binds a single-use approval to immutable arguments", async () => {
    const audit = new InMemoryAuditSink();
    const gate = new ApprovalGate(audit, 60_000);
    const context = { correlationId: "corr-12345678", actor: "user" };
    const request = await gate.request(context, "disk.delete", ["delete_local"], "danger", { path: "a.txt" });
    expect(await gate.decide(request.id, true)).toBe(true);
    expect(await gate.consume(request.id, context, "disk.delete", ["delete_local"], { path: "b.txt" })).toBe(false);
    expect(await gate.consume(request.id, context, "disk.delete", ["delete_local"], { path: "a.txt" })).toBe(false);
  });

  it("allows the exact approved action only once", async () => {
    const gate = new ApprovalGate(new InMemoryAuditSink(), 60_000);
    const context = { correlationId: "corr-abcdefgh", actor: "user" };
    const request = await gate.request(context, "write", ["write_local"], "write", { value: 1 });
    await gate.decide(request.id, true);
    expect(await gate.consume(request.id, context, "write", ["write_local"], { value: 1 })).toBe(true);
    expect(await gate.consume(request.id, context, "write", ["write_local"], { value: 1 })).toBe(false);
  });

  it("fails closed when approval audit cannot be persisted", async () => {
    const audit = new ToggleAuditSink();
    const gate = new ApprovalGate(audit, 60_000);
    const context = { correlationId: "corr-auditfail", actor: "user" };
    const request = await gate.request(context, "write", ["write_local"], "write", { value: 1 });
    audit.fail = true;
    await expect(gate.decide(request.id, true)).rejects.toThrow("audit unavailable");
    expect(await gate.consume(request.id, context, "write", ["write_local"], { value: 1 })).toBe(false);
  });
});

describe("secure paths", () => {
  it.each(["../x", "..\\x", "C:\\Windows\\x", "\\\\server\\share", "safe/file:stream", "CON", "dir/NUL.txt"])("rejects %s", async (candidate) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-path-"));
    const resolver = new SecurePathResolver(root);
    await expect(resolver.resolve(candidate)).rejects.toThrow();
  });

  it("rejects symlink escape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "akariya-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "akariya-out-"));
    await mkdir(path.join(root, "safe"));
    const link = path.join(root, "safe", "link");
    try { await symlink(outside, link, process.platform === "win32" ? "junction" : "dir"); }
    catch { return; }
    const resolver = new SecurePathResolver(root);
    await expect(resolver.resolve("safe/link/file.txt")).rejects.toThrow();
  });
});
