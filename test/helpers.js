// Shared fixtures for the autogit test suite.
// Everything runs against scratch repos under os.tmpdir() with a scratch HOME,
// so the user's real git config and agent configs are never touched.
import { spawnSync } from "node:child_process";
import {
  chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const indexPath = fileURLToPath(new URL("../index.js", import.meta.url));

const created = [];

// realpathSync: on macOS tmpdir() lives behind /var -> /private/var symlinks,
// and git resolves them — normalize up front so path comparisons hold.
export function makeTempDir(prefix = "autogit-") {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

export function cleanup() {
  for (const dir of created.splice(0)) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// One scratch HOME per test process (node --test runs each file in its own
// process). Keeps ~/.gitconfig, ~/.claude etc. out of every invocation.
export const defaultHome = makeTempDir("autogit-home-");

function baseEnv(home = defaultHome) {
  return {
    PATH: process.env.PATH,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    TMPDIR: tmpdir(),
  };
}

// Run git in a fixture repo; throws on failure (fixture bugs must be loud).
export function gitIn(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: baseEnv() });
  if (r.status !== 0) {
    throw new Error(`fixture git ${args.join(" ")} in ${cwd} failed:\n${r.stdout}\n${r.stderr}`);
  }
  return (r.stdout || "").trim();
}

// Scratch repo: main branch, local identity, initial commit (HEAD exists),
// bare remote wired up as origin. Nothing is pushed yet — ship creates the
// remote branch.
export function makeRepo({ branch = "main" } = {}) {
  const base = makeTempDir("autogit-fixture-");
  const repo = path.join(base, "repo");
  const bare = path.join(base, "remote.git");
  mkdirSync(repo);
  gitIn(base, "init", "--bare", "-b", branch, bare);
  gitIn(base, "init", "-b", branch, repo);
  gitIn(repo, "config", "user.email", "tests@example.com");
  gitIn(repo, "config", "user.name", "Autogit Tests");
  gitIn(repo, "config", "commit.gpgsign", "false");
  writeFileSync(path.join(repo, "README.md"), "# fixture\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-m", "initial commit");
  gitIn(repo, "remote", "add", "origin", bare);
  return { base, repo, bare, branch };
}

// Run the CLI exactly like a hook would: spawnSync(node, [index.js, ...]).
// `input` (string or object) becomes the stdin payload; default "" keeps
// stdin a non-TTY pipe so readStdinPayload behaves as in production.
export function runCli(args, { cwd, input, env = {}, home = defaultHome } = {}) {
  const stdin = input === undefined ? ""
    : typeof input === "string" ? input : JSON.stringify(input);
  const r = spawnSync(process.execPath, [indexPath, ...args], {
    cwd,
    input: stdin,
    encoding: "utf8",
    env: { ...baseEnv(home), ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Simulate one agent turn: `busy` (carries the prompt) then `ship`, same session.
export function turn(repo, { prompt, session = "s1", args = [], env, home } = {}) {
  if (prompt !== undefined) {
    const b = runCli(["busy"], {
      cwd: repo, env, home,
      input: { session_id: session, prompt, workspace_roots: [repo] },
    });
    if (b.status !== 0) throw new Error(`busy failed:\n${b.stderr}`);
  }
  return runCli(["ship", ...args], {
    cwd: repo, env, home,
    input: { session_id: session, workspace_roots: [repo] },
  });
}

// ---------- repo inspection ----------

export function headSha(repo) { return gitIn(repo, "rev-parse", "HEAD"); }
export function headSubject(repo) { return gitIn(repo, "log", "-1", "--format=%s"); }
export function headBody(repo) { return gitIn(repo, "log", "-1", "--format=%B"); }
export function commitCount(repo) { return Number(gitIn(repo, "rev-list", "--count", "HEAD")); }
export function porcelain(repo) { return gitIn(repo, "status", "--porcelain"); }
export function stagedFiles(repo) {
  return gitIn(repo, "diff", "--cached", "--name-only").split("\n").filter(Boolean);
}

// ---------- bare remote inspection ----------

export function remoteSha(bare, branch = "main") {
  const r = spawnSync("git", ["--git-dir", bare, "rev-parse", `refs/heads/${branch}`],
    { encoding: "utf8", env: baseEnv() });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function remoteBody(bare, branch = "main") {
  const r = spawnSync("git", ["--git-dir", bare, "log", "-1", "--format=%B", branch],
    { encoding: "utf8", env: baseEnv() });
  return r.status === 0 ? r.stdout.trim() : null;
}

// ---------- config / files ----------

// New config home per SPEC: <git-common-dir>/autogit.json (.git in a main worktree).
export function gitDirConfig(repo) { return path.join(repo, ".git", "autogit.json"); }
export function legacyConfig(repo) { return path.join(repo, ".autogit.json"); }
export function pendingPath(repo) { return path.join(repo, ".git", "autogit-pending.json"); }
export function busyMarkerDir(repo) { return path.join(repo, ".git", "autogit-busy"); }

// Opt a repo in by writing the git-dir config directly (tests of `on` itself
// use the command).
export function enable(repo, config = { mode: "auto" }) {
  writeFileSync(gitDirConfig(repo), JSON.stringify(config, null, 2) + "\n");
}

export function write(repo, rel, content) {
  const p = path.join(repo, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
  return p;
}

export function backdate(file, ms) {
  const t = new Date(Date.now() - ms);
  utimesSync(file, t, t);
}

// Temp bin dir of executable stubs, for PATH control (e.g. a failing `gh`).
export function makeStubBinDir(stubs) {
  const dir = makeTempDir("autogit-bin-");
  for (const [name, content] of Object.entries(stubs)) {
    const p = path.join(dir, name);
    writeFileSync(p, content);
    chmodSync(p, 0o755);
  }
  return dir;
}

export function assertExit(r, code, label = "") {
  assert.equal(r.status, code,
    `${label ? label + ": " : ""}expected exit ${code}, got ${r.status}\n--- stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`);
}
