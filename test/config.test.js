// Config location: on/off, git-dir config, legacy root .autogit.json migration.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  makeRepo, runCli, enable, write, headSha, commitCount, porcelain,
  remoteSha, gitIn, gitDirConfig, legacyConfig, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

describe("on", () => {
  it("writes config to .git/autogit.json, not the repo root", () => {
    const { repo } = makeRepo();
    const r = runCli(["on"], { cwd: repo });
    assertExit(r, 0);
    assert.ok(existsSync(gitDirConfig(repo)), "config should live in the git dir");
    assert.ok(!existsSync(legacyConfig(repo)), "no config file at the repo root");
    assert.equal(porcelain(repo), "", "repo root must stay clean after on");
  });

  it("migrates a legacy root config: deletes it, writes the git-dir file", () => {
    const { repo } = makeRepo();
    write(repo, ".autogit.json", JSON.stringify({ mode: "auto" }) + "\n");
    const r = runCli(["on"], { cwd: repo });
    assertExit(r, 0);
    assert.ok(!existsSync(legacyConfig(repo)), "legacy file should be deleted");
    assert.ok(existsSync(gitDirConfig(repo)));
    assert.match(r.stderr, /migrated/i);
  });

  it("warns when the migrated legacy config was committed", () => {
    const { repo } = makeRepo();
    write(repo, ".autogit.json", JSON.stringify({ mode: "auto" }) + "\n");
    gitIn(repo, "add", ".autogit.json");
    gitIn(repo, "commit", "-m", "add legacy autogit config");
    const r = runCli(["on"], { cwd: repo });
    assertExit(r, 0);
    assert.ok(!existsSync(legacyConfig(repo)));
    assert.match(r.stderr, /committed/i);
  });
});

describe("legacy config fallback", () => {
  it("ship still honors a legacy root .autogit.json and prints a migration note", () => {
    const { repo, bare } = makeRepo();
    write(repo, ".autogit.json", JSON.stringify({ mode: "auto" }) + "\n");
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2);
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.match(r.stderr, /legacy/i);
  });
});

describe("off", () => {
  it("removes both config locations", () => {
    const { repo } = makeRepo();
    enable(repo);
    write(repo, ".autogit.json", JSON.stringify({ mode: "auto" }) + "\n");
    const r = runCli(["off"], { cwd: repo });
    assertExit(r, 0);
    assert.ok(!existsSync(gitDirConfig(repo)));
    assert.ok(!existsSync(legacyConfig(repo)));
  });
});
