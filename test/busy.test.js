// Busy markers: defer while another session is mid-turn, clean stale markers.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  makeRepo, runCli, enable, write, headSha, commitCount, remoteSha,
  busyMarkerDir, backdate, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

describe("busy/defer", () => {
  it("defers when another session's marker is fresh", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    const dir = busyMarkerDir(repo);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "other-session"), "");
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship"], {
      cwd: repo,
      input: { session_id: "s1", workspace_roots: [repo] },
    });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 1, "no commit while another agent is busy");
    assert.equal(remoteSha(bare), null);
    assert.match(r.stderr, /defer/i);
  });

  it("cleans up a stale marker (>15 min old) and ships", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    const dir = busyMarkerDir(repo);
    mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, "crashed-session");
    writeFileSync(marker, "");
    backdate(marker, 16 * 60 * 1000); // older than the 15 min TTL
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship"], {
      cwd: repo,
      input: { session_id: "s1", workspace_roots: [repo] },
    });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2, "stale marker must not block shipping");
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.ok(!existsSync(marker), "stale marker should be deleted");
  });
});
