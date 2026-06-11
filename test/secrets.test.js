// Secrets scanning: content patterns (old + v0.5.0 additions), sensitive
// filenames, --force-secrets, and the Anthropic/OpenAI labeling fix.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  makeRepo, runCli, enable, write, headSha, commitCount, stagedFiles,
  remoteSha, assertExit, cleanup,
} from "./helpers.js";

after(cleanup);

const AWS_KEY = "AKIA" + "ABCDEFGHIJKLMNOP"; // AKIA + 16 [0-9A-Z]

describe("secrets: content scan", () => {
  it("blocks a staged AWS key: exit 1, nothing staged, no commit", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "notes.txt", `key = ${AWS_KEY}\n`);
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 1);
    assert.equal(commitCount(repo), 1);
    assert.equal(stagedFiles(repo).length, 0, "block must unstage everything");
    assert.equal(remoteSha(bare), null);
    assert.match(r.stderr, /AWS access key/);
  });

  it("--force-secrets ships it anyway", () => {
    const { repo, bare } = makeRepo();
    enable(repo);
    write(repo, "notes.txt", `key = ${AWS_KEY}\n`);
    const r = runCli(["ship", "--force-secrets"], { cwd: repo });
    assertExit(r, 0);
    assert.equal(commitCount(repo), 2);
    assert.equal(remoteSha(bare, "main"), headSha(repo));
  });

  // v0.5.0 pattern additions
  const tokens = [
    ["Stripe key", "sk_live_" + "a1b2c3d4e5f6a7b8"],
    ["npm token", "npm_" + "a1".repeat(18)],
    ["GitHub fine-grained token", "github_pat_" + "A".repeat(36)],
    ["GitLab token", "glpat-" + "x".repeat(20)],
    ["SendGrid key", "SG." + "a".repeat(20) + "." + "b".repeat(20)],
    ["Twilio API key", "SK" + "0123456789abcdef".repeat(2)],
    ["npmrc auth token", "//registry.example.com/:_authToken=abc123def456ghi789"],
  ];
  for (const [label, token] of tokens) {
    it(`blocks: ${label}`, () => {
      const { repo, bare } = makeRepo();
      enable(repo);
      write(repo, "notes.txt", `value: ${token}\n`);
      const r = runCli(["ship"], { cwd: repo });
      assertExit(r, 1, label);
      assert.equal(commitCount(repo), 1);
      assert.equal(stagedFiles(repo).length, 0);
      assert.equal(remoteSha(bare), null);
      assert.ok(r.stderr.includes(label),
        `stderr should name "${label}":\n${r.stderr}`);
    });
  }

  it("labels an Anthropic key as Anthropic, not OpenAI", () => {
    const { repo } = makeRepo();
    enable(repo);
    write(repo, "notes.txt", "token = sk-ant-" + "a0".repeat(15) + "\n");
    const r = runCli(["ship"], { cwd: repo });
    assertExit(r, 1);
    assert.ok(r.stderr.includes("Anthropic key"),
      `stderr should say Anthropic key:\n${r.stderr}`);
    assert.ok(!r.stderr.includes("OpenAI key"),
      `stderr must not mislabel as OpenAI key:\n${r.stderr}`);
  });
});

describe("secrets: sensitive filenames", () => {
  for (const name of [".env", ".npmrc", "id_ed25519"]) {
    it(`blocks: ${name}`, () => {
      const { repo, bare } = makeRepo();
      enable(repo);
      write(repo, name, "harmless=1\n");
      const r = runCli(["ship"], { cwd: repo });
      assertExit(r, 1, name);
      assert.equal(commitCount(repo), 1);
      assert.equal(stagedFiles(repo).length, 0);
      assert.equal(remoteSha(bare), null);
      assert.match(r.stderr, /sensitive filename/);
    });
  }
});
