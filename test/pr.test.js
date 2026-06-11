// Feature B: PR mode. PATH is controlled with a stub `gh` that always fails
// its --version probe, so behavior is identical whether or not the real gh
// is installed: push must land on refs/heads/autogit/<branch>, exit 0.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeRepo, runCli, enable, write, headSha, commitCount, porcelain,
  remoteSha, remoteBody, makeStubBinDir, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

const stubBin = makeStubBinDir({ gh: "#!/bin/sh\nexit 1\n" });
const env = { PATH: `${stubBin}:${process.env.PATH}` };

describe("PR mode", () => {
  it("ship pushes to autogit/<branch>; exit 0 with no usable gh", () => {
    const { repo, bare } = makeRepo();
    enable(repo, { mode: "auto", pr: true });
    write(repo, "a.txt", "x\n");
    const r = runCli(["ship"], { cwd: repo, env });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2);
    assert.equal(remoteSha(bare, "autogit/main"), headSha(repo),
      "push lands on refs/heads/autogit/main");
    assert.equal(remoteSha(bare, "main"), null, "main itself is not pushed");
    assert.match(remoteBody(bare, "autogit/main"), /Shipped-by: autogit/);
    assert.match(r.stderr, /autogit\/main/);
  });

  it("undo rewinds autogit/<branch> on the remote", () => {
    const { repo, bare } = makeRepo();
    enable(repo, { mode: "auto", pr: true });
    const parent = headSha(repo);
    write(repo, "a.txt", "x\n");
    assertExit(runCli(["ship"], { cwd: repo, env }), 0, "ship");
    const shipped = headSha(repo);
    assert.equal(remoteSha(bare, "autogit/main"), shipped, "fixture: shipped to PR branch");

    const r = runCli(["undo"], { cwd: repo, env });
    assertExit(r, 0);
    assert.equal(headSha(repo), parent, "local HEAD rewound");
    assert.equal(remoteSha(bare, "autogit/main"), parent, "PR branch rewound");
    assert.match(porcelain(repo), /a\.txt/, "changes back in the working tree");
  });
});
