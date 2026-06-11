// Commit-subject pipeline: prompt via busy marker, truncation, secret prompts,
// promptWorthy filtering (Feature C).
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeRepo, enable, write, turn, headSha, headSubject, headBody,
  commitCount, remoteSha, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

const FILE_LIST_PREFIX = "autogit: update ";

describe("subjects: prompts", () => {
  it("uses this turn's prompt as the commit subject", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "x\n");
    const prompt = "Refactor the widget loader for clarity";
    const r = turn(repo, { prompt });
    assertExit(r, 0);
    assert.equal(headSubject(repo), prompt);
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    assert.match(headBody(repo), /Shipped-by: autogit/);
  });

  it("truncates a 73+ char prompt to <= 72 chars with a ... suffix", () => {
    const { repo } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "x\n");
    const prompt =
      "Please rework the entire data ingestion pipeline so that records stream incrementally end to end";
    assert.ok(prompt.length > 72);
    const r = turn(repo, { prompt });
    assertExit(r, 0);
    const subject = headSubject(repo);
    assert.ok(subject.length <= 72, `subject too long (${subject.length}): ${subject}`);
    assert.ok(subject.endsWith("..."), `subject should end with ...: ${subject}`);
    assert.ok(prompt.startsWith(subject.slice(0, -3).trimEnd()),
      `truncated subject should be a prefix of the prompt: ${subject}`);
  });

  it("a prompt containing a secret falls back to the file-list subject", () => {
    const { repo } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "x\n");
    const prompt = "use this aws key AKIA" + "ABCDEFGHIJKLMNOP" + " for the deploy";
    const r = turn(repo, { prompt });
    assertExit(r, 0);
    const subject = headSubject(repo);
    assert.ok(subject.startsWith(FILE_LIST_PREFIX), `expected file-list subject, got: ${subject}`);
    assert.ok(!subject.includes("AKIA"), "secret must never leak into the subject");
  });
});

describe("subjects: promptWorthy filtering", () => {
  const unworthy = [
    "yes",
    "ok",
    "sounds good",
    "/compact the conversation now", // slash command, length irrelevant
    "hello hello", // 11 chars: below the 12-char floor
  ];
  unworthy.forEach((prompt, i) => {
    it(`unworthy prompt ${JSON.stringify(prompt)} -> file-list subject`, () => {
      const { repo } = makeRepo();
      enable(repo);
      write(repo, `f${i}.txt`, `change ${i}\n`);
      const r = turn(repo, { prompt });
      assertExit(r, 0);
      const subject = headSubject(repo);
      assert.ok(subject.startsWith(FILE_LIST_PREFIX),
        `expected file-list subject for ${JSON.stringify(prompt)}, got: ${subject}`);
      assert.equal(commitCount(repo), 2);
    });
  });

  it("a worthy 12+ char prompt is used verbatim", () => {
    const { repo } = makeRepo();
    enable(repo);
    write(repo, "a.txt", "x\n");
    const prompt = "tighten the retry loop"; // 22 chars, not a pleasantry
    const r = turn(repo, { prompt });
    assertExit(r, 0);
    assert.equal(headSubject(repo), prompt);
  });
});
