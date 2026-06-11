// Feature A: quiet batching. Uses "300s" and never waits on real timers —
// freshness is controlled by backdating the pending file's mtime.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  makeRepo, runCli, enable, write, turn, headSha, headSubject, headBody,
  commitCount, porcelain, remoteSha, pendingPath, backdate, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

const QUIET = { mode: "auto", quiet: "300s" };
const QUIET_MS = 300_000;

function readPending(repo) {
  return JSON.parse(readFileSync(pendingPath(repo), "utf8"));
}

describe("quiet: batching", () => {
  it("first turn batches: no commit, pending file holds the prompt", () => {
    const { repo, bare } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    const r = turn(repo, { prompt: "add feature alpha" });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1, "no commit yet");
    assert.equal(remoteSha(bare), null, "no push yet");
    assert.match(r.stderr, /batched/i);
    assert.ok(existsSync(pendingPath(repo)), "pending file should exist");
    const pending = readPending(repo);
    assert.ok(Array.isArray(pending.prompts), "pending.prompts is an array");
    assert.ok(pending.prompts.includes("add feature alpha"));
  });

  it("second turn appends its prompt to the pending batch", () => {
    const { repo } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    assertExit(turn(repo, { prompt: "add feature alpha", session: "s1" }), 0, "turn 1");
    write(repo, "b.txt", "y\n");
    assertExit(turn(repo, { prompt: "add feature beta", session: "s2" }), 0, "turn 2");
    assert.equal(commitCount(repo), 1, "still no commit");
    const pending = readPending(repo);
    assert.ok(pending.prompts.includes("add feature alpha"));
    assert.ok(pending.prompts.includes("add feature beta"));
  });

  it("a prompt containing a secret is never stored in pending", () => {
    const { repo } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    const r = turn(repo, { prompt: "use AKIA" + "ABCDEFGHIJKLMNOP" + " as the deploy key" });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1);
    if (existsSync(pendingPath(repo))) {
      assert.ok(!readFileSync(pendingPath(repo), "utf8").includes("AKIA"),
        "secret leaked into the pending file");
    }
  });

  it("backstop: pending older than quiet ships everything in one commit", () => {
    const { repo, bare } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    assertExit(turn(repo, { prompt: "add feature alpha", session: "s1" }), 0, "turn 1");
    write(repo, "b.txt", "y\n");
    assertExit(turn(repo, { prompt: "add feature beta", session: "s2" }), 0, "turn 2");
    backdate(pendingPath(repo), QUIET_MS + 60_000); // the batch aged past quiet

    write(repo, "c.txt", "z\n");
    const r = turn(repo, { prompt: "wire feature gamma", session: "s3" });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2, "one batch commit");
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.equal(porcelain(repo), "", "all three turns' files committed");
    assert.equal(headSubject(repo), "wire feature gamma", "subject = last worthy prompt");
    const body = headBody(repo);
    assert.match(body, /- add feature alpha/, "bullet for prompt 1");
    assert.match(body, /- add feature beta/, "bullet for prompt 2");
    assert.match(body, /Shipped-by: autogit/);
    assert.ok(!existsSync(pendingPath(repo)), "pending file gone after the batch ships");
  });
});

describe("quiet: ship --flush", () => {
  it("ships the pending batch immediately", () => {
    const { repo, bare } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    assertExit(turn(repo, { prompt: "add feature alpha" }), 0, "batched turn");
    write(repo, "b.txt", "y\n"); // plus an uncommitted change
    const r = runCli(["ship", "--flush"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2);
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.equal(headSubject(repo), "add feature alpha");
    assert.equal(porcelain(repo), "", "flush ships pending + uncommitted changes");
    assert.ok(!existsSync(pendingPath(repo)), "pending file gone after flush");
  });
});

describe("quiet: ship --timer", () => {
  it("--timer 0 exits silently when pending has newer activity than its deadline", () => {
    const { repo, bare } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    assertExit(turn(repo, { prompt: "add feature alpha" }), 0, "batched turn");
    // The SPEC's timer bails when age(pending) < its ms, i.e. when a turn
    // landed after the timer's deadline (a newer timer exists). Model that
    // deterministically: date the pending file AFTER this timer's deadline
    // (--timer 0 sleeps only its 1.5s grace, so "now + 60s" is safely newer).
    backdate(pendingPath(repo), -60_000);
    const r = runCli(["ship", "--timer", "0"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1, "pending with newer activity must not ship");
    assert.equal(remoteSha(bare), null);
    assert.ok(existsSync(pendingPath(repo)), "pending file untouched");
  });

  it("--timer 0 ships synchronously once the pending batch is old enough", () => {
    const { repo, bare } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    assertExit(turn(repo, { prompt: "add feature alpha" }), 0, "batched turn");
    backdate(pendingPath(repo), QUIET_MS + 60_000);
    const r = runCli(["ship", "--timer", "0"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2);
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.equal(headSubject(repo), "add feature alpha");
    assert.ok(!existsSync(pendingPath(repo)));
  });
});

describe("quiet: status", () => {
  it("status reports the pending batch", () => {
    const { repo } = makeRepo();
    enable(repo, QUIET);
    write(repo, "a.txt", "x\n");
    assertExit(turn(repo, { prompt: "add feature alpha" }), 0, "batched turn");
    const r = runCli(["status"], { cwd: repo });
    assertExit(r, 0);
    assert.match(r.stdout, /pending/i);
  });
});
