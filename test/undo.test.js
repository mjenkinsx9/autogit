// undo: local + remote rewind, trailer check, remote-moved-past refusal,
// and the local-only path when the branch never reached the remote
// (exercises the stderr "couldn't find remote ref" matching after MUST-FIX 3).
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeRepo, runCli, enable, write, headSha, commitCount, porcelain,
  remoteSha, gitIn, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

describe("undo", () => {
  it("rewinds local HEAD and the remote, keeps changes uncommitted", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    const parent = headSha(repo);
    write(repo, "a.txt", "x\n");
    assertExit(runCli(["ship"], { cwd: repo }), 0, "ship");
    const shipped = headSha(repo);
    assert.notEqual(shipped, parent, "fixture: ship should have committed");
    assert.equal(remoteSha(bare, "main"), shipped);

    const r = runCli(["undo"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(headSha(repo), parent, "local HEAD back at the parent");
    assert.equal(remoteSha(bare, "main"), parent, "remote branch rewound to the parent");
    assert.match(porcelain(repo), /a\.txt/, "the changes stay in the working tree, uncommitted");
  });

  it("refuses a commit without the autogit trailer: exit 1", () => {
    const { repo } = makeRepo();
    write(repo, "a.txt", "x\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-m", "hand-made commit");
    const head = headSha(repo);
    const r = runCli(["undo"], { cwd: repo });
    assertExit(r, 1);
    assert.equal(headSha(repo), head, "HEAD untouched");
    assert.equal(commitCount(repo), 2);
  });

  it("refuses when the remote moved past the shipped commit: exit 1", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "x\n");
    assertExit(runCli(["ship"], { cwd: repo }), 0, "ship");
    const shipped = headSha(repo);
    // someone else pushed on top of our shipped commit
    gitIn(repo, "commit", "--allow-empty", "-m", "someone else's commit");
    gitIn(repo, "push", "origin", "HEAD:main");
    const moved = headSha(repo);
    gitIn(repo, "reset", "--hard", "HEAD~1");
    assert.equal(remoteSha(bare, "main"), moved, "fixture: remote is ahead");

    const r = runCli(["undo"], { cwd: repo });
    assertExit(r, 1);
    assert.equal(headSha(repo), shipped, "local HEAD untouched");
    assert.equal(remoteSha(bare, "main"), moved, "remote untouched");
  });

  it("local-only undo when the branch was never pushed", () => {
    const { repo, bare } = makeRepo();
    const parent = headSha(repo);
    write(repo, "a.txt", "x\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-m", "autogit-style commit", "-m", "Shipped-by: autogit");
    assert.equal(remoteSha(bare, "main"), null, "fixture: branch absent on the remote");

    // fetch prints "couldn't find remote ref" on stderr — undo must still
    // recognize it (git() stream split) and fall back to a local-only undo
    const r = runCli(["undo"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(headSha(repo), parent);
    assert.equal(remoteSha(bare, "main"), null);
    assert.match(porcelain(repo), /a\.txt/);
  });
});
