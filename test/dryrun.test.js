// ship --dry-run (Feature D): report-only, exit 0 always, nothing durable.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeRepo, runCli, enable, write, commitCount, stagedFiles, remoteSha,
  assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

describe("ship --dry-run", () => {
  it("with changes: reports files, subject and target; commits nothing", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship", "--dry-run"], { cwd: repo });
    assertExit(r, 0);
    assert.match(r.stderr, /dry run/i);
    assert.match(r.stderr, /a\.txt/);
    assert.match(r.stderr, /autogit: update a\.txt/); // the computed subject
    assert.match(r.stderr, /origin\/main/); // the computed target
    assert.equal(commitCount(repo), 1, "no commit");
    assert.equal(remoteSha(bare), null, "no push");
    assert.equal(stagedFiles(repo).length, 0, "nothing left staged afterward");
  });

  it("with a secret: reports would-BLOCK, still exit 0, no commit", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "notes.txt", "key = AKIA" + "ABCDEFGHIJKLMNOP" + "\n");
    const r = runCli(["ship", "--dry-run"], { cwd: repo });
    assertExit(r, 0);
    assert.match(r.stderr, /BLOCK/);
    assert.equal(commitCount(repo), 1);
    assert.equal(remoteSha(bare), null);
    assert.equal(stagedFiles(repo).length, 0);
  });

  it("with nothing to ship: exit 0", () => {
    const { repo } = makeRepo();
    enable(repo);
    const r = runCli(["ship", "--dry-run"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1);
  });
});
