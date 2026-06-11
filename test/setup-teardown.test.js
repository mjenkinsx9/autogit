// setup / teardown against a scratch HOME — the real home is never touched.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { makeTempDir, runCli, assertExit, cleanup } from "./helpers.js";

after(cleanup);

function homeWithClaude(preexisting) {
  const home = makeTempDir("autogit-home-");
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  const file = path.join(home, ".claude", "settings.json");
  if (preexisting) writeFileSync(file, JSON.stringify(preexisting, null, 2) + "\n");
  return { home, file };
}

describe("setup", () => {
  it("wires Claude Stop + UserPromptSubmit + PostToolUse hooks", () => {
    const { home, file } = homeWithClaude();
    const r = runCli(["setup"], { home });
    assertExit(r, 0);
    assert.ok(existsSync(file), "settings.json should be created");
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    assert.match(JSON.stringify(cfg.hooks?.Stop ?? []), /autogit ship/);
    assert.match(JSON.stringify(cfg.hooks?.UserPromptSubmit ?? []), /autogit busy/);
    assert.match(JSON.stringify(cfg.hooks?.PostToolUse ?? []), /autogit busy/);
  });

  it("is idempotent: a second run changes nothing", () => {
    const { home, file } = homeWithClaude();
    assertExit(runCli(["setup"], { home }), 0, "first setup");
    const before = readFileSync(file, "utf8");
    const r = runCli(["setup"], { home });
    assertExit(r, 0, "second setup");
    assert.equal(readFileSync(file, "utf8"), before, "file bytes must be identical");
  });
});

describe("teardown", () => {
  it("removes autogit entries, keeps pre-existing hooks and settings", () => {
    const { home, file } = homeWithClaude({
      model: "opus",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo keepme" }] }],
        PreToolUse: [{ hooks: [{ type: "command", command: "echo other" }] }],
      },
    });
    assertExit(runCli(["setup"], { home }), 0, "setup");
    assert.match(readFileSync(file, "utf8"), /autogit/, "fixture: setup wired autogit");

    const r = runCli(["teardown"], { home });
    assertExit(r, 0);
    const raw = readFileSync(file, "utf8");
    assert.ok(!raw.includes("autogit"), `autogit entries should be gone:\n${raw}`);
    const cfg = JSON.parse(raw);
    assert.equal(cfg.model, "opus", "unrelated settings untouched");
    assert.equal(cfg.hooks.Stop.length, 1, "pre-existing Stop hook kept");
    assert.match(JSON.stringify(cfg.hooks.Stop[0]), /keepme/);
    assert.match(JSON.stringify(cfg.hooks.PreToolUse), /echo other/);
    assert.ok(!("UserPromptSubmit" in cfg.hooks), "emptied event keys removed");
    assert.ok(!("PostToolUse" in cfg.hooks), "emptied event keys removed");
  });

  it("is idempotent: second run reports nothing to remove, changes nothing", () => {
    const { home, file } = homeWithClaude();
    assertExit(runCli(["setup"], { home }), 0, "setup");
    assertExit(runCli(["teardown"], { home }), 0, "first teardown");
    const before = readFileSync(file, "utf8");
    const r = runCli(["teardown"], { home });
    assertExit(r, 0, "second teardown");
    assert.match(r.stdout, /nothing to remove/);
    assert.equal(readFileSync(file, "utf8"), before);
  });

  it("on a machine with no agents: exit 0 and prints the per-repo footer", () => {
    const home = makeTempDir("autogit-home-");
    const r = runCli(["teardown"], { home });
    assertExit(r, 0);
    assert.match(r.stdout, /Per-repo configs are untouched/);
  });
});

describe("Pi extension", () => {
  const ext = home => path.join(home, ".pi", "agent", "extensions", "autogit.ts");

  it("setup writes it; teardown deletes it", () => {
    const home = makeTempDir("autogit-home-");
    mkdirSync(path.join(home, ".pi"), { recursive: true });
    assertExit(runCli(["setup"], { home }), 0, "setup");
    assert.ok(existsSync(ext(home)), "extension written");
    assert.match(readFileSync(ext(home), "utf8"), /autogit/);

    assertExit(runCli(["teardown"], { home }), 0, "teardown");
    assert.ok(!existsSync(ext(home)), "extension deleted");
  });

  it("teardown does not delete an extension that isn't ours", () => {
    const home = makeTempDir("autogit-home-");
    mkdirSync(path.dirname(ext(home)), { recursive: true });
    // same filename, but the content has no "autogit" in it — not ours
    writeFileSync(ext(home), "export default function () {}\n");
    const r = runCli(["teardown"], { home });
    assertExit(r, 0);
    assert.ok(existsSync(ext(home)), "foreign file must survive teardown");
  });
});
