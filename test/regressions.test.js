// Regression tests for the silent-failure fixes: failed-push recovery,
// fail-closed secrets scanning under diff.external, corrupt-config guards in
// undo/status, visible `git add` failures, corrupt pending batches, deferred
// prompts joining the batch, and the no-noise guard for empty quiet turns.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  makeRepo, runCli, enable, write, turn, gitIn, headSha, commitCount,
  stagedFiles, remoteSha, pendingPath, busyMarkerDir, backdate,
  makeStubBinDir, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

const QUIET = { mode: "auto", quiet: "300s" };
const QUIET_MS = 300_000;

function pushFailedPath(repo) { return path.join(repo, ".git", "autogit-push-failed.json"); }
function breakRemote(repo) { gitIn(repo, "remote", "set-url", "origin", "/nonexistent/bare.git"); }
function fixRemote(repo, bare) { gitIn(repo, "remote", "set-url", "origin", bare); }

// Opted-in repo with one shipped-but-unpushed commit: the push failed and the
// recovery marker is on disk. Returns the failed ship's result for inspection.
function shipWithBrokenPush(repo) {
  enable(repo);
  breakRemote(repo);
  write(repo, "a.txt", "x\n");
  return runCli(["ship"], { cwd: repo });
}

describe("failed-push recovery", () => {
  it("failed push: exit 1, commit kept locally, marker records remote/target/sha", () => {
    const { repo, bare } = makeRepo();
    const r = shipWithBrokenPush(repo);
    assertExit(r, 1);
    assert.match(r.stderr, /push failed/i);
    assert.match(r.stderr, /retries next turn/i, "stderr promises a retry");
    assert.equal(commitCount(repo), 2, "the commit is kept locally");
    assert.equal(remoteSha(bare, "main"), null, "nothing reached the remote");
    assert.ok(existsSync(pushFailedPath(repo)), "failed-push marker written");
    const saved = JSON.parse(readFileSync(pushFailedPath(repo), "utf8"));
    assert.equal(saved.remote, "origin");
    assert.equal(saved.target, "main");
    assert.equal(saved.sha, headSha(repo), "marker records the stranded sha");
  });

  it("status reports the failed push", () => {
    const { repo } = makeRepo();
    assertExit(shipWithBrokenPush(repo), 1, "fixture ship");
    const r = runCli(["status"], { cwd: repo });
    assertExit(r, 0);
    assert.match(r.stdout, /push FAILED/, "status surfaces the stranded push");
  });

  it("next no-change ship delivers the stranded push and clears the marker", () => {
    const { repo, bare } = makeRepo();
    assertExit(shipWithBrokenPush(repo), 1, "fixture ship");
    fixRemote(repo, bare);
    const r = runCli(["ship"], { cwd: repo }); // no new changes
    assertExit(r, 0);
    assert.match(r.stderr, /delivered the earlier failed push/);
    assert.equal(remoteSha(bare, "main"), headSha(repo), "stranded commit reached the remote");
    assert.ok(!existsSync(pushFailedPath(repo)), "marker cleared after delivery");
  });

  it("a later successful ship to the same destination settles the marker", () => {
    const { repo, bare } = makeRepo();
    assertExit(shipWithBrokenPush(repo), 1, "fixture ship");
    fixRemote(repo, bare);
    write(repo, "b.txt", "y\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 3, "the new turn committed");
    assert.equal(remoteSha(bare, "main"), headSha(repo),
      "both the stranded and the new commit landed");
    assert.ok(!existsSync(pushFailedPath(repo)),
      "same-destination push settles the marker");
  });

  it("dry run mentions the pending retry but neither pushes nor consumes the marker", () => {
    const { repo, bare } = makeRepo();
    assertExit(shipWithBrokenPush(repo), 1, "fixture ship");
    fixRemote(repo, bare);
    const r = runCli(["ship", "--dry-run"], { cwd: repo }); // no new changes
    assertExit(r, 0);
    assert.match(r.stderr, /failed push would be retried/);
    assert.ok(existsSync(pushFailedPath(repo)), "dry run leaves the marker alone");
    assert.equal(remoteSha(bare, "main"), null, "dry run pushes nothing");
  });
});

describe("secrets scan fails closed", () => {
  it("blocks a staged AWS key even when diff.external would blind a plain diff", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    // /bin/false as external diff makes a plain `git diff` fail / emit nothing;
    // the scan must still see the real diff via --no-ext-diff.
    gitIn(repo, "config", "diff.external", "/bin/false");
    write(repo, "secret.txt", "aws_key = AKIA" + "ABCDEFGHIJKLMNOP" + "\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 1);
    assert.match(r.stderr, /blocked — possible secrets/);
    assert.match(r.stderr, /secret\.txt: AWS access key/, "the finding names file and pattern");
    assert.equal(commitCount(repo), 1, "no commit");
    assert.equal(remoteSha(bare, "main"), null, "no push");
    assert.deepEqual(stagedFiles(repo), [], "nothing left staged after the block");
  });
});

describe("undo with a corrupt config", () => {
  it("dies on invalid JSON instead of rewinding the wrong ref with defaults", () => {
    const { repo, bare } = makeRepo();
    enable(repo, { mode: "auto", pr: true });
    const stubBin = makeStubBinDir({ gh: "#!/bin/sh\nexit 1\n" });
    const env = { PATH: `${stubBin}:${process.env.PATH}` };
    write(repo, "a.txt", "x\n");
    assertExit(runCli(["ship"], { cwd: repo, env }), 0, "PR-mode ship");
    const shipped = headSha(repo);
    assert.equal(remoteSha(bare, "autogit/main"), shipped, "fixture: shipped to the PR branch");

    writeFileSync(path.join(repo, ".git", "autogit.json"), "{oops");
    const r = runCli(["undo"], { cwd: repo, env });
    assertExit(r, 1);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(headSha(repo), shipped, "local HEAD untouched");
    assert.equal(remoteSha(bare, "autogit/main"), shipped, "remote PR branch untouched");
  });
});

describe("git add failure is visible", () => {
  it("an index.lock makes ship exit 1 with the git add error, not a silent 0", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "x\n");
    const lock = path.join(repo, ".git", "index.lock");
    writeFileSync(lock, "");
    try {
      const r = runCli(["ship"], { cwd: repo });
      assertExit(r, 1);
      assert.match(r.stderr, /git add failed/);
      assert.equal(commitCount(repo), 1, "no commit");
      assert.equal(remoteSha(bare, "main"), null, "no push");
    } finally {
      unlinkSync(lock);
    }
  });
});

describe("corrupt pending batch", () => {
  it("still ships, says the batched prompts were lost, and clears the file", () => {
    const { repo, bare } = makeRepo();
    enable(repo, QUIET);
    writeFileSync(pendingPath(repo), "{oops");
    backdate(pendingPath(repo), QUIET_MS + 60_000); // aged past quiet → backstop fires
    write(repo, "a.txt", "x\n");
    const r = turn(repo, { prompt: "recover from the corrupt batch" });
    assertExit(r, 0);
    assert.match(r.stderr, /pending batch file was unreadable/);
    assert.equal(commitCount(repo), 2, "the turn shipped despite the corrupt batch");
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.ok(!existsSync(pendingPath(repo)), "pending file gone after the ship");
  });
});

describe("status with a corrupt config", () => {
  it("reports INVALID JSON and still exits 0", () => {
    const { repo } = makeRepo();
    writeFileSync(path.join(repo, ".git", "autogit.json"), "{oops");
    const r = runCli(["status"], { cwd: repo });
    assertExit(r, 0);
    assert.match(r.stdout, /INVALID JSON/);
  });
});

describe("deferred turn joins the quiet batch", () => {
  it("a ship deferred by another agent still parks its prompt in pending", () => {
    const { repo } = makeRepo();
    enable(repo, QUIET);
    const dir = busyMarkerDir(repo);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "other-session"), ""); // fresh foreign marker
    write(repo, "a.txt", "x\n");
    const r = turn(repo, { prompt: "implement the gamma feature", session: "s1" });
    assertExit(r, 0);
    assert.match(r.stderr, /deferred/i);
    assert.equal(commitCount(repo), 1, "no commit while the other agent is busy");
    assert.ok(existsSync(pendingPath(repo)), "deferred prompt must not vanish");
    const pending = JSON.parse(readFileSync(pendingPath(repo), "utf8"));
    assert.ok(pending.prompts.includes("implement the gamma feature"),
      "the deferred turn's prompt is in the batch");
  });
});

describe("no-noise guard", () => {
  it("an empty quiet turn with no prompt creates no pending file", () => {
    const { repo } = makeRepo();
    enable(repo, QUIET); // clean tree, no pending, no busy marker
    const r = runCli(["ship"], {
      cwd: repo,
      input: { session_id: "s1", workspace_roots: [repo] },
    });
    assertExit(r, 0);
    assert.ok(!existsSync(pendingPath(repo)),
      "an empty turn must not start a phantom batch");
    assert.equal(commitCount(repo), 1);
  });
});
