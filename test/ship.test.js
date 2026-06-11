// Core ship behavior: opt-in gate, commit+push, status gate, merge/rebase
// guard, detached HEAD, multi-root resilience.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  makeRepo, runCli, enable, write, headSha, commitCount, porcelain,
  stagedFiles, remoteSha, remoteBody, gitIn, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

describe("ship: opt-in gate", () => {
  it("without config: exit 0, no commit created", () => {
    const { repo, bare } = makeRepo();
    const before = headSha(repo);
    write(repo, "a.txt", "hello\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(headSha(repo), before);
    assert.equal(commitCount(repo), 1);
    assert.equal(remoteSha(bare), null);
  });

  it("opted in but nothing changed: clean no-op", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    const before = headSha(repo);
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(headSha(repo), before);
    assert.equal(remoteSha(bare), null);
  });
});

describe("ship: basic commit & push", () => {
  it("commits, pushes, bare tip matches local HEAD, trailer present", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "hello\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2);
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.match(remoteBody(bare, "main"), /Shipped-by: autogit/);
    assert.equal(porcelain(repo), "", "working tree should be clean after ship");
  });
});

describe("ship: Cursor status gate", () => {
  it("aborted turn: exit 0, no commit", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "hello\n");
    const r = runCli(["ship"], {
      cwd: repo,
      input: { status: "aborted", session_id: "s1", workspace_roots: [repo] },
    });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1);
    assert.equal(remoteSha(bare), null);
  });
});

describe("ship: merge/rebase guard", () => {
  it("MERGE_HEAD present: exit 0, no commit, mentions in progress", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    writeFileSync(path.join(repo, ".git", "MERGE_HEAD"), headSha(repo) + "\n");
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1);
    assert.equal(remoteSha(bare), null);
    assert.match(r.stderr, /in progress/i);
    assert.equal(stagedFiles(repo).length, 0, "guard must fire before staging");
  });

  it("rebase-merge dir present: exit 0, no commit, mentions in progress", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    mkdirSync(path.join(repo, ".git", "rebase-merge"));
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1);
    assert.equal(remoteSha(bare), null);
    assert.match(r.stderr, /in progress/i);
  });
});

describe("ship: detached HEAD", () => {
  it("exit 1, no push, nothing left staged", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    gitIn(repo, "checkout", "--detach");
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 1);
    assert.equal(commitCount(repo), 1);
    assert.equal(remoteSha(bare), null);
    assert.equal(stagedFiles(repo).length, 0);
  });
});

describe("ship: multi-root", () => {
  it("a failing root does not stop the rest; overall exit 1", () => {
    const a = makeRepo();
    const b = makeRepo();
    enable(a.repo);
    enable(b.repo);
    gitIn(a.repo, "remote", "remove", "origin"); // push in A will fail
    write(a.repo, "broken.txt", "x\n");
    write(b.repo, "fine.txt", "y\n");
    const r = runCli(["ship"], {
      cwd: a.repo,
      input: { session_id: "s1", workspace_roots: [a.repo, b.repo] },
    });
    assertExit(r, 1);
    // repoB still shipped despite repoA's failure
    assert.equal(commitCount(b.repo), 2);
    assert.equal(remoteSha(b.bare, "main"), headSha(b.repo));
    assert.match(r.stderr, /autogit:/);
  });
});
