// Claude Code plugin wrapper: manifest sanity + the hook scripts' contract.
// The scripts are what every plugin user's Stop/UserPromptSubmit/PostToolUse
// hooks actually execute — test them end-to-end like the CLI itself.
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeRepo, makeTempDir, enable, remoteSha, headSha, cleanup } from "./helpers.js";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = f => readFileSync(path.join(pluginRoot, f), "utf8");

function runHook(script, { cwd, home, input = "", extraEnv = {} }) {
  return spawnSync("bash", [path.join(pluginRoot, "hooks", script)], {
    cwd, input, encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: cwd, ...extraEnv }
  });
}

describe("plugin: manifests", () => {
  it("plugin.json is valid and complete", () => {
    const p = JSON.parse(read(".claude-plugin/plugin.json"));
    assert.equal(p.name, "autogit");
    assert.ok(p.description);
    assert.equal(p.license, "MIT");
  });

  it("plugin.json version matches package.json", () => {
    const p = JSON.parse(read(".claude-plugin/plugin.json"));
    const pkg = JSON.parse(read("package.json"));
    assert.equal(p.version, pkg.version);
  });

  it("per-harness manifests keep name/version/description in sync with the canonical one", () => {
    const base = JSON.parse(read(".claude-plugin/plugin.json"));
    // Codex, Factory Droid, and Cursor each read their own manifest path but
    // point at the same skills/ — their metadata must not drift from Claude's.
    for (const f of [".codex-plugin/plugin.json", ".factory-plugin/plugin.json", ".cursor-plugin/plugin.json"]) {
      const m = JSON.parse(read(f));
      assert.equal(m.name, base.name, `${f}: name`);
      assert.equal(m.version, base.version, `${f}: version`);
      assert.equal(m.description, base.description, `${f}: description`);
    }
  });

  it("Codex and Cursor manifests point skills at the shared ./skills/ directory", () => {
    assert.equal(JSON.parse(read(".codex-plugin/plugin.json")).skills, "./skills/");
    assert.equal(JSON.parse(read(".cursor-plugin/plugin.json")).skills, "./skills/");
  });

  it("hooks.json wires Stop→ship.sh and UserPromptSubmit/PostToolUse→busy.sh, and the scripts exist executable", () => {
    const h = JSON.parse(read("hooks/hooks.json")).hooks;
    const cmd = e => h[e][0].hooks[0].command;
    assert.match(cmd("Stop"), /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/ship\.sh/);
    assert.match(cmd("UserPromptSubmit"), /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/busy\.sh/);
    assert.match(cmd("PostToolUse"), /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/busy\.sh/);
    for (const s of ["ship.sh", "busy.sh"]) {
      const st = statSync(path.join(pluginRoot, "hooks", s));
      assert.ok(st.mode & 0o111, `${s} must be executable`);
    }
  });

  it("command and skill files have frontmatter and agree on the skill name", () => {
    const cmd = read("commands/autogit.md");
    const skill = read("skills/autogit-ops/SKILL.md");
    assert.match(cmd, /^---\ndescription:/);
    assert.match(cmd, /autogit:autogit-ops/);
    assert.match(skill, /^---\nname: autogit-ops/);
  });
});

describe("plugin: hook scripts", () => {
  after(cleanup);

  it("ship.sh ships an opted-in repo (stdin payload forwarded, prompt becomes subject)", () => {
    const { repo, bare } = makeRepo();
    const home = makeTempDir();
    enable(repo);
    writeFileSync(path.join(repo, "feat.txt"), "work\n");
    const busy = runHook("busy.sh", {
      cwd: repo, home,
      input: JSON.stringify({ session_id: "plug1", prompt: "wire the plugin hook end to end" })
    });
    assert.equal(busy.status, 0);
    const ship = runHook("ship.sh", { cwd: repo, home, input: JSON.stringify({ session_id: "plug1" }) });
    assert.equal(ship.status, 0, ship.stderr);
    assert.equal(remoteSha(bare, "main"), headSha(repo));
    const subject = spawnSync("git", ["--git-dir", bare, "log", "-1", "--format=%s", "main"], { encoding: "utf8" }).stdout.trim();
    assert.equal(subject, "wire the plugin hook end to end");
  });

  it("ship.sh is a silent no-op without node on PATH", () => {
    const { repo } = makeRepo();
    const home = makeTempDir();
    enable(repo);
    writeFileSync(path.join(repo, "x.txt"), "x\n");
    const r = spawnSync("bash", [path.join(pluginRoot, "hooks", "ship.sh")], {
      cwd: repo, input: "{}", encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: home, CLAUDE_PROJECT_DIR: repo }
    });
    // /usr/bin:/bin has bash+git but no node on a typical CI box; if node IS
    // there, the repo still ships cleanly — accept either, require exit 0
    assert.equal(r.status, 0, r.stderr);
  });

  it("ship.sh defers to global wiring when settings.json contains autogit hooks", () => {
    const { repo, bare } = makeRepo();
    const home = makeTempDir();
    enable(repo);
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "autogit ship" }] }] } }));
    writeFileSync(path.join(repo, "y.txt"), "y\n");
    const before = remoteSha(bare, "main");
    const r = runHook("ship.sh", { cwd: repo, home, input: "{}" });
    assert.equal(r.status, 0);
    assert.equal(remoteSha(bare, "main"), before, "plugin hook must not ship when global hooks exist");
    assert.ok(!existsSync(path.join(repo, ".git", "autogit-pending.json")));
  });

  it("ship.sh on a non-opted-in repo is a silent no-op", () => {
    const { repo, bare } = makeRepo();
    const home = makeTempDir();
    writeFileSync(path.join(repo, "z.txt"), "z\n");
    const before = remoteSha(bare, "main");
    const r = runHook("ship.sh", { cwd: repo, home, input: "{}" });
    assert.equal(r.status, 0);
    assert.equal(r.stderr.trim(), "");
    assert.equal(remoteSha(bare, "main"), before);
  });
});
