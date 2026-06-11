#!/usr/bin/env node
// Zero-dependency CLI, ESM, Node >=18.
// autogit — auto stage→commit→push for agentic engineers
//   autogit setup     wire agent hooks globally (once per machine)
//   autogit teardown  unwire agent hooks (reverses setup)
//   autogit on/off    enable/disable auto-push in current repo
//   autogit ship      stage, scan, commit, push (what the hooks run)
//   autogit undo      take back the last autogit commit (local + remote)
//   autogit status    show hooks + repo state
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync, utimesSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LEGACY_CONFIG_FILE = ".autogit.json"; // pre-0.5 repo-root config — committed by accident, hence the move
const CONFIG_NAME = "autogit.json";         // lives in the git common dir: never committed, never shipped
// Version comes from package.json — single source of truth.
const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
// Defaults mirror the MVP's current auto-push behavior.
const DEFAULTS = { mode: "auto", remote: "origin", branch: "current", secretsScan: true, quiet: 0, pr: false };
// Trailer added to every commit body — this is how `undo` knows a commit is ours.
const SHIP_TRAILER = "Shipped-by: autogit";

// ---------- helpers ----------
// Helpers wrap git/fs calls so commands above stay readable.

function git(...args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  const out = (r.stdout || "").trim(), err = (r.stderr || "").trim();
  // parse values from .out; report errors from .all (git errors land on stderr)
  return { ok: r.status === 0, out, err, all: [out, err].filter(Boolean).join("\n") };
}

function die(msg, code = 1) { console.error(`✗ autogit: ${msg}`); process.exit(code); }
// stderr, not stdout: Codex Stop hooks treat plain text on stdout as invalid JSON.
function ok(msg) { console.error(`✓ autogit: ${msg}`); }

function repoRootOrNull() {
  const r = git("rev-parse", "--show-toplevel");
  return r.ok ? r.out : null;
}

// Per-worktree git dir — busy markers and the pending batch live here, so
// each checkout debounces and defers independently.
function gitDir() {
  const gd = git("rev-parse", "--git-dir").out; // relative to cwd in the main worktree
  return path.resolve(process.cwd(), gd);
}

// Common dir = one per clone, shared by all worktrees — config lives here.
function gitCommonDir() {
  const gd = git("rev-parse", "--git-common-dir").out;
  return path.resolve(process.cwd(), gd);
}

function configPath() { return path.join(gitCommonDir(), CONFIG_NAME); }

// New location wins; the legacy root file is still honored so existing users
// don't silently lose auto-push.
function findConfig(root) {
  const p = configPath();
  if (existsSync(p)) return { path: p, legacy: false };
  const lp = path.join(root, LEGACY_CONFIG_FILE);
  if (existsSync(lp)) return { path: lp, legacy: true };
  return null;
}

// `quiet` config: number = seconds, or "90s" / "5m". 0/absent = ship immediately.
function parseQuiet(v) {
  if (typeof v === "number" && v > 0) return v * 1000;
  if (typeof v === "string") {
    const m = /^(\d+)(s|m)?$/.exec(v.trim());
    if (m) return Number(m[1]) * (m[2] === "m" ? 60000 : 1000);
  }
  return 0;
}

function quietLabel(v) { return typeof v === "number" ? `${v}s` : String(v); }

// Single source of truth for the remote-side branch — ship AND undo use it,
// so PR mode rewinds the same ref it pushed to.
function remoteBranchFor(config, localBranch) {
  return config.pr ? "autogit/" + localBranch
    : (config.branch === "current" ? localBranch : config.branch);
}

// ---------- secrets scanning ----------
// Keep patterns conservative to avoid surprising false positives.

const SECRET_PATTERNS = [
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  // Anthropic before OpenAI; the lookahead keeps the labels correct.
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_\-]{20,}/ },
  { name: "OpenAI key", re: /sk-(?!ant-)[A-Za-z0-9_\-]{20,}/ },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "GitHub fine-grained token", re: /github_pat_[A-Za-z0-9_]{36,}/ },
  { name: "GitLab token", re: /glpat-[A-Za-z0-9_\-]{20,}/ },
  { name: "Stripe key", re: /[sr]k_(live|test)_[A-Za-z0-9]{16,}/ },
  { name: "npm token", re: /npm_[A-Za-z0-9]{36}/ },
  { name: "SendGrid key", re: /SG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}/ },
  { name: "Twilio API key", re: /SK[0-9a-f]{32}/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9\-]{10,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_\-]{35}/ },
  { name: "npmrc auth token", re: /_authToken\s*=\s*\S+/ },
  { name: "Generic API key assignment", re: /(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i },
  { name: "JWT", re: /eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/ }
];

const SENSITIVE_FILES = [
  /^\.env(\..+)?$/, /\.pem$/, /\.key$/, /id_rsa/, /credentials\.json$/,
  /^\.npmrc$/, /^\.pypirc$/, /id_ed25519/, /\.p12$/, /\.pfx$/
];

// Prompts can carry pasted secrets — those must never become commit subjects.
// Checks the full text (not the truncated subject) so a key cut off at 72
// chars can't leak its prefix. Same conservative patterns as the diff scan.
function hasSecret(text) {
  return SECRET_PATTERNS.some(({ re }) => re.test(text));
}

// Returns findings, or null when the scan itself failed — callers must treat
// null as a block, never as clean. --no-ext-diff: difftastic/delta-style
// diff.external tools emit no "+" lines, which would blind the scan entirely.
function scanSecrets() {
  const findings = [];
  const names = git("diff", "--no-ext-diff", "--cached", "--name-only");
  const diff = git("diff", "--no-ext-diff", "--cached", "--unified=0");
  if (!names.ok || !diff.ok) return null;

  for (const f of names.out.split("\n").filter(Boolean)) {
    if (SENSITIVE_FILES.some(re => re.test(path.basename(f)))) {
      findings.push({ file: f, issue: "sensitive filename" });
    }
  }

  // only scan added lines
  let currentFile = "";
  for (const line of diff.out.split("\n")) {
    if (line.startsWith("+++ b/")) { currentFile = line.slice(6); continue; }
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(line)) findings.push({ file: currentFile, issue: name });
    }
  }
  return findings;
}

// ---------- setup: wire agent hooks globally ----------

// Shared JSON config merge: parse, apply mutations, write only if changed.
function updateJson(file, mutate) {
  let cfg = {};
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, "utf8")); }
    catch { return `could not parse ${file} — skipped, fix it and rerun`; }
  }
  const before = JSON.stringify(cfg);
  mutate(cfg);
  if (JSON.stringify(cfg) === before) return "already wired";
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
  return null; // changed — caller crafts the message
}

// Add an entry only if its command isn't anywhere in the config yet —
// makes setup safely re-runnable and lets upgrades add new hooks.
function ensure(cfg, needle, add) {
  if (!JSON.stringify(cfg).includes(needle)) add(cfg);
}

// Claude settings.json and Codex hooks.json share the same event entry shape.
function claudeStyleEntry(cfg, event, command) {
  cfg.hooks ??= {};
  cfg.hooks[event] ??= [];
  cfg.hooks[event].push({ hooks: [{ type: "command", command }] });
}

function setupClaude() {
  if (!existsSync(path.join(homedir(), ".claude"))) return "not installed — skipped";
  const file = path.join(homedir(), ".claude", "settings.json");
  // cd to the project dir: Claude hooks don't guarantee the working directory
  const ship = 'cd "${CLAUDE_PROJECT_DIR:-.}" && autogit ship';
  const busy = 'cd "${CLAUDE_PROJECT_DIR:-.}" && autogit busy';
  return updateJson(file, cfg => {
    ensure(cfg, "autogit ship", c => claudeStyleEntry(c, "Stop", ship));
    ensure(cfg, "autogit busy", c => {
      claudeStyleEntry(c, "UserPromptSubmit", busy);
      claudeStyleEntry(c, "PostToolUse", busy); // refreshes the marker during long turns
    });
  }) ?? `wired (${file})`;
}

function setupCodex() {
  if (!existsSync(path.join(homedir(), ".codex"))) return "not installed — skipped";
  // Codex ≥0.124 lifecycle hooks; runs commands in the session cwd.
  // Separate file, so the user's config.toml (incl. legacy notify) stays untouched.
  const file = path.join(homedir(), ".codex", "hooks.json");
  return updateJson(file, cfg => {
    ensure(cfg, "autogit ship", c => claudeStyleEntry(c, "Stop", "autogit ship"));
    ensure(cfg, "autogit busy", c => {
      claudeStyleEntry(c, "UserPromptSubmit", "autogit busy");
      claudeStyleEntry(c, "PostToolUse", "autogit busy");
    });
  // Codex trust is hash-based: it silently skips hooks until the user trusts
  // them via /hooks, and re-flags them whenever this file's entries change.
  // Live edits also disable hooks in already-running sessions until restart.
  }) ?? `wired (${file}) — restart any open codex sessions, then run /hooks inside codex to trust autogit`;
}

function setupCursor() {
  if (!existsSync(path.join(homedir(), ".cursor"))) return "not installed — skipped";
  // Cursor stop hooks run from ~/.cursor and pass workspace_roots via stdin JSON.
  // Local + worktree agents fire it; cloud agents don't support stop hooks yet.
  const file = path.join(homedir(), ".cursor", "hooks.json");
  const entry = (cfg, event, command) => {
    cfg.hooks ??= {};
    cfg.hooks[event] ??= [];
    cfg.hooks[event].push({ command });
  };
  return updateJson(file, cfg => {
    cfg.version ??= 1;
    ensure(cfg, "autogit ship", c => entry(c, "stop", "autogit ship"));
    ensure(cfg, "autogit busy", c => {
      entry(c, "beforeSubmitPrompt", "autogit busy");
      entry(c, "postToolUse", "autogit busy");
    });
  }) ?? `wired (${file})`;
}

// Pi auto-discovers extensions in ~/.pi/agent/extensions/ — we drop one in.
// Plain ESM, no types: valid for Pi's jiti loader, easy to verify with node.
const PI_EXTENSION = `// autogit — auto stage→commit→push after every agent turn
// Generated by \`autogit setup\`. Delete this file to unwire Pi.
import { spawn } from "node:child_process";

export default function (pi) {
  const id = "pi-" + process.pid;
  const busy = (ctx) => {
    spawn("autogit", ["busy", "--id", id], { cwd: ctx.cwd, stdio: "ignore" }).on("error", () => {});
  };
  pi.on("agent_start", (_event, ctx) => busy(ctx));
  pi.on("tool_execution_end", (_event, ctx) => busy(ctx)); // refresh during long turns

  pi.on("agent_end", (_event, ctx) => {
    const p = spawn("autogit", ["ship", "--id", id], { cwd: ctx.cwd, stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => {
      if (code !== 0) ctx.ui.notify("autogit: " + (err.trim() || "ship failed"), "error");
    });
    p.on("error", () => ctx.ui.notify("autogit: not found on PATH", "error"));
  });
}
`;

function setupPi() {
  const dir = path.join(homedir(), ".pi");
  if (!existsSync(dir)) return "not installed — skipped";
  const file = path.join(dir, "agent", "extensions", "autogit.ts");
  // content compare, so upgrades rewrite the extension
  if (existsSync(file) && readFileSync(file, "utf8") === PI_EXTENSION) return "already wired";
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, PI_EXTENSION);
  return `wired (extension at ${file})`;
}

function cmdSetup() {
  console.log(`Claude Code:  ${setupClaude()}`);
  console.log(`Codex:        ${setupCodex()}`);
  console.log(`Cursor:       ${setupCursor()}`);
  console.log(`Pi:           ${setupPi()}`);
  console.log(`\nNow opt in the repos you want auto-pushed:\n  cd <repo> && autogit on`);
}

// ---------- teardown: unwire agent hooks ----------

// Strip every hook entry mentioning autogit; drop emptied event arrays and an
// emptied hooks object so the config looks untouched again.
function unwireHooks(file) {
  if (!existsSync(file)) return "nothing to remove";
  const r = updateJson(file, cfg => {
    if (!cfg.hooks) return;
    for (const event of Object.keys(cfg.hooks)) {
      if (Array.isArray(cfg.hooks[event]))
        cfg.hooks[event] = cfg.hooks[event].filter(e => !JSON.stringify(e).includes("autogit"));
      if (!cfg.hooks[event] || cfg.hooks[event].length === 0) delete cfg.hooks[event];
    }
    if (Object.keys(cfg.hooks).length === 0) delete cfg.hooks;
  });
  if (r === "already wired") return "nothing to remove"; // unchanged
  return r ?? `unwired (${file})`;
}

function teardownClaude() {
  if (!existsSync(path.join(homedir(), ".claude"))) return "not installed — skipped";
  return unwireHooks(path.join(homedir(), ".claude", "settings.json"));
}

function teardownCodex() {
  if (!existsSync(path.join(homedir(), ".codex"))) return "not installed — skipped";
  return unwireHooks(path.join(homedir(), ".codex", "hooks.json"));
}

function teardownCursor() {
  if (!existsSync(path.join(homedir(), ".cursor"))) return "not installed — skipped";
  return unwireHooks(path.join(homedir(), ".cursor", "hooks.json")); // version key stays
}

function teardownPi() {
  if (!existsSync(path.join(homedir(), ".pi"))) return "not installed — skipped";
  const file = path.join(homedir(), ".pi", "agent", "extensions", "autogit.ts");
  if (!existsSync(file)) return "nothing to remove";
  // safety: never delete a file that isn't ours
  if (!readFileSync(file, "utf8").includes("autogit")) return `left alone (${file} doesn't look like ours)`;
  unlinkSync(file);
  return `unwired (${file})`;
}

function cmdTeardown() {
  console.log(`Claude Code:  ${teardownClaude()}`);
  console.log(`Codex:        ${teardownCodex()}`);
  console.log(`Cursor:       ${teardownCursor()}`);
  console.log(`Pi:           ${teardownPi()}`);
  console.log(`\nPer-repo configs are untouched — run "autogit off" inside a repo to disable it there.`);
}

// ---------- on / off ----------

function cmdOn() {
  const root = repoRootOrNull();
  if (!root) die("not inside a git repository.");
  process.chdir(root);
  const p = configPath();
  const legacy = path.join(root, LEGACY_CONFIG_FILE);
  const had = existsSync(p);
  if (!had) writeFileSync(p, JSON.stringify({ mode: "auto" }, null, 2) + "\n");
  if (existsSync(legacy)) {
    // tracked legacy config is the contagion bug — its deletion must ship
    const tracked = git("ls-files", "--error-unmatch", LEGACY_CONFIG_FILE).ok;
    unlinkSync(legacy);
    ok(`migrated config to ${p}`);
    if (tracked) ok("note: .autogit.json was committed — its deletion will ship with the next turn.");
    return;
  }
  if (had) { ok("already on."); return; }
  ok(`auto-push ON — every agent turn in this repo now ships to git.`);
}

function cmdOff() {
  const root = repoRootOrNull();
  if (!root) die("not inside a git repository.");
  process.chdir(root);
  let removed = false;
  for (const f of [configPath(), path.join(root, LEGACY_CONFIG_FILE)]) {
    if (existsSync(f)) { unlinkSync(f); removed = true; }
  }
  ok(removed ? "auto-push OFF." : "already off.");
}

// ---------- busy markers ----------
// While an agent is mid-turn it holds a marker file; ship defers if any other
// agent's marker is fresh. The last agent to finish ships everything.

const BUSY_TTL_MS = 15 * 60 * 1000; // markers older than this are stale (crashed agent)

function busyDir() {
  // per-worktree git dir, which isolates busy markers per checkout
  return path.join(gitDir(), "autogit-busy");
}

function sessionId(payload, args) {
  const i = args.indexOf("--id");
  if (i !== -1 && args[i + 1]) return args[i + 1];
  const raw = payload?.session_id || payload?.conversation_id
    || payload?.thread_id || payload?.["thread-id"]
    || payload?.turn_id || payload?.["turn-id"];
  return raw ? String(raw) : null;
}

function markerPath(root, id) {
  return path.join(busyDir(), id.replace(/[^A-Za-z0-9._-]/g, "_"));
}

// `autogit busy` — called by agent start/tool hooks; touches this session's marker.
// Must stay silent: some hooks treat stdout as context or JSON.
// Marker content = the turn's user prompt (prompt-submit hooks carry it) —
// ship reads it back as the commit subject. Tool hooks carry no prompt, so
// they only refresh mtime and leave the stored prompt alone.
function cmdBusy(args) {
  const payload = readStdinPayload();
  const id = sessionId(payload, args);
  if (!id) return; // no session id → no marker: nobody could ever clear it
  const prompt = promptText(payload);
  const roots = payload?.workspace_roots?.length ? payload.workspace_roots : [process.cwd()];
  for (const dir of roots) {
    try {
      process.chdir(dir);
      const root = repoRootOrNull();
      if (!root || !findConfig(root)) continue; // only opted-in repos
      const marker = markerPath(root, id);
      mkdirSync(path.dirname(marker), { recursive: true });
      if (prompt || !existsSync(marker)) writeFileSync(marker, prompt || "");
      else { const now = new Date(); utimesSync(marker, now, now); } // mtime is the freshness signal
    } catch {}
  }
}

// Read & clear this session's own marker; returns the stored prompt (if any).
// `keep` leaves the marker in place (dry-run must not consume it).
function takeOwnMarker(root, id, keep = false) {
  if (!id) return null;
  try {
    const p = markerPath(root, id);
    const prompt = readFileSync(p, "utf8").trim();
    if (!keep) unlinkSync(p);
    return prompt || null;
  } catch { return null; }
}

// Returns true if another agent is mid-turn in this repo. Cleans stale markers.
function othersBusy(root) {
  const dir = busyDir();
  if (!existsSync(dir)) return false;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (Date.now() - statSync(p).mtimeMs > BUSY_TTL_MS) { unlinkSync(p); continue; }
      return true;
    } catch {}
  }
  return false;
}

// ---------- quiet batching ----------
// No daemon: each turn refreshes a pending file (mtime = last activity) and
// spawns a detached timer; the timer ships once the repo has been quiet long
// enough. A backstop in the next ship covers timers that never fired.

function pendingFile() { return path.join(gitDir(), "autogit-pending.json"); }

function readPending(p) {
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { since: j.since ?? Date.now(), prompts: Array.isArray(j.prompts) ? j.prompts : [] };
  } catch {
    // corrupt (e.g. killed mid-write) — the code still ships, but say why the
    // commit message lost the batched intents
    console.error("autogit: pending batch file was unreadable — batched prompts lost.");
    return null;
  }
}

// Secrets never enter pending; consecutive duplicates collapse.
function appendPrompt(prompts, p) {
  if (p && !hasSecret(p) && prompts[prompts.length - 1] !== p) prompts.push(p);
}

function spawnQuietTimer(root, quietMs) {
  spawn(process.execPath, [fileURLToPath(import.meta.url), "ship", "--timer", String(quietMs)],
    { cwd: root, detached: true, stdio: "ignore" }).unref();
}

// ---------- failed-push recovery ----------
// The detached timer's stderr is discarded — without a trace on disk, a batch
// whose push failed would silently never reach the remote (commit kept locally,
// every later no-change turn exits 0). The marker makes later invocations retry.

function pushFailedFile() { return path.join(gitDir(), "autogit-push-failed.json"); }

function notePushFailed(remote, target, sha) {
  try { writeFileSync(pushFailedFile(), JSON.stringify({ remote, target, sha }) + "\n"); } catch {}
}

// Deliver (or settle) a recorded failed push. justPushed = the remote/target a
// push just succeeded to — same destination means the marker is already covered.
// Pushes the recorded SHA, not HEAD: the user may have switched branches since.
function settleFailedPush(justPushed) {
  const p = pushFailedFile();
  if (!existsSync(p)) return null;
  let saved; try { saved = JSON.parse(readFileSync(p, "utf8")); } catch { saved = null; }
  if (!saved?.remote || !saved?.target || !saved?.sha) { try { unlinkSync(p); } catch {} return null; }
  if (justPushed && saved.remote === justPushed.remote && saved.target === justPushed.target) {
    try { unlinkSync(p); } catch {}
    return null;
  }
  const push = git("push", saved.remote, `${saved.sha}:refs/heads/${saved.target}`);
  if (!push.ok) return `retrying earlier failed push — failed again (commit kept locally):\n${push.all}`;
  try { unlinkSync(p); } catch {}
  ok(`delivered the earlier failed push → ${saved.remote}/${saved.target}`);
  return null;
}

// ---------- ship ----------

function autoMessage(stagedFiles) {
  const names = stagedFiles.map(f => path.basename(f));
  const head = names.slice(0, 3).join(", ");
  const rest = names.length > 3 ? ` (+${names.length - 3} more)` : "";
  return `autogit: update ${head}${rest}`;
}

// Pull the user's prompt out of a hook payload. Prompt-submit payloads vary
// per agent — check the common spellings, both string and { text } shapes.
function promptText(payload) {
  for (const v of [payload?.prompt, payload?.text, payload?.user_prompt, payload?.message]) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v?.text === "string" && v.text.trim()) return v.text.trim();
  }
  return null;
}

// Stop payloads carry no prompt, but point at the session transcript.
// Claude transcripts and Codex rollouts are both JSONL — walk backwards for
// the last real user message. Line shapes (officially unstable; parse defensively):
//   Claude: {"type":"user","message":{"content":"..."|[{"type":"text","text":"..."}]}}
//   Codex:  {"type":"event_msg","payload":{"type":"user_message","message":"..."}}
function lastPromptFromTranscript(file) {
  try {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      let e; try { e = JSON.parse(lines[i]); } catch { continue; }
      let text;
      if (e.type === "user" && !e.isMeta) { // Claude
        const c = e.message?.content;
        text = typeof c === "string" ? c
          : Array.isArray(c) ? c.filter(p => p.type === "text").map(p => p.text).join(" ") : "";
      } else if (e.type === "event_msg" && e.payload?.type === "user_message") { // Codex
        text = typeof e.payload.message === "string" ? e.payload.message : "";
      } else continue;
      // skip tool results, slash-command noise, <user_instructions>/<environment_context> blobs
      if (!text.trim() || text.trim().startsWith("<")) continue;
      return text.trim();
    }
  } catch {}
  return null;
}

// "yes" / "do it" / slash commands make useless commit subjects — skip to the
// next candidate in the precedence chain.
function promptWorthy(s) {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 12) return false;                 // "yes", "ok", "do it"
  if (t.startsWith("/")) return false;             // slash commands
  if (/^(yes|no|ok(ay)?|yep|nope|sure|go( ahead)?|continue|proceed|do it|try again|fix it|thanks( a lot)?|thank you|good|great|nice|perfect|done|next|keep going|carry on|sounds good|lgtm|approved?|please (continue|proceed)|y|n)[.!? ]*$/i.test(t)) return false;
  return true;
}

// One-line commit subject, capped at the conventional 72 chars.
function subjectFrom(prompt) {
  const s = prompt.replace(/\s+/g, " ").trim();
  return s.length > 72 ? s.slice(0, 69).trimEnd() + "..." : s;
}

// First WORTHY candidate wins: stored marker > payload prompt > transcript >
// the agent's final message. Unworthy ones fall through; the file list is the
// final fallback (in shipCore).
function turnPrompt(storedPrompt, payload) {
  const candidates = [
    storedPrompt,
    promptText(payload),
    payload?.transcript_path ? lastPromptFromTranscript(payload.transcript_path) : null,
    typeof payload?.last_assistant_message === "string" && payload.last_assistant_message.trim()
      ? payload.last_assistant_message.trim() : null
  ];
  for (const c of candidates) if (c && promptWorthy(c)) return c;
  return null;
}

// Hooks (Cursor, Claude, Codex) pass a JSON payload on stdin.
function readStdinPayload() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = readFileSync(0, "utf8").trim();
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Any of these inside the per-worktree git dir means git owns the working
// tree right now — staging would wreck the operation in progress.
const GIT_OP_MARKERS = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG", "rebase-apply", "rebase-merge"];

function gitOpInProgress() {
  const gd = gitDir();
  return GIT_OP_MARKERS.some(f => existsSync(path.join(gd, f)));
}

function cmdShip(args) {
  // internal: the detached quiet timer re-enters here — no stdin, no session
  const tIdx = args.indexOf("--timer");
  if (tIdx !== -1) {
    const ms = Math.max(0, Number(args[tIdx + 1]) || 0);
    // grace so the last writer's mtime is strictly older than quietMs by check time
    setTimeout(() => {
      const err = shipRepo(process.cwd(), args, null, null);
      if (err) { console.error(`✗ autogit: ${err}`); process.exit(1); }
    }, ms + 1500);
    return;
  }

  const payload = readStdinPayload();
  // Cursor reports turn status — never ship aborted or errored turns
  if (payload?.status && payload.status !== "completed") process.exit(0);
  // Cursor hooks run from ~/.cursor; the real project dirs come in the payload
  const roots = payload?.workspace_roots?.length ? payload.workspace_roots : [process.cwd()];
  const id = sessionId(payload, args);
  // run every root even if one fails — collect, report, exit 1 at the end
  let failed = false;
  for (const dir of roots) {
    const err = shipRepo(dir, args, id, payload);
    if (err) { console.error(`✗ autogit: ${err}`); failed = true; }
  }
  if (failed) process.exit(1);
}

// Returns null on success/no-op, or an error string — never exits, so a
// multi-root loop completes every repo.
function shipRepo(dir, args, id, payload) {
  try { process.chdir(dir); } catch { return null; }

  // silent no-op unless this is a repo that opted in — hooks fire everywhere
  const root = repoRootOrNull();
  if (!root) return null;
  const found = findConfig(root);
  if (!found) return null;
  process.chdir(root);

  const dryRun = args.includes("--dry-run");
  const flush = args.includes("--flush");
  const tIdx = args.indexOf("--timer");
  const timer = tIdx !== -1;

  let config;
  try { config = { ...DEFAULTS, ...JSON.parse(readFileSync(found.path, "utf8")) }; }
  catch { return `${found.path} is not valid JSON.`; }
  if (config.mode !== "auto") {
    console.error(`autogit: mode "${config.mode}" not supported yet — skipping.`);
    return null;
  }
  if (found.legacy)
    console.error('autogit: legacy .autogit.json found — run "autogit on" to migrate it out of the repo.');

  // clear our own marker first — it may hold this turn's prompt
  const storedPrompt = takeOwnMarker(root, id, dryRun);

  const pending = pendingFile();
  if (timer) {
    if (!existsSync(pending)) return null; // already flushed or shipped
    const ms = Math.max(0, Number(args[tIdx + 1]) || 0);
    if (Date.now() - statSync(pending).mtimeMs < ms) return null; // newer activity — a newer timer exists
  }

  const quietMs = parseQuiet(config.quiet);
  const thisPrompt = timer ? null : turnPrompt(storedPrompt, payload);

  // another agent mid-turn? defer — the last one to finish ships everything
  if (othersBusy(root)) {
    // with quiet on, our marker (and its prompt) is already consumed — park
    // the prompt in the batch so the eventual ship keeps this turn's intent
    if (quietMs > 0 && !dryRun && thisPrompt && !hasSecret(thisPrompt)) {
      const batch = readPending(pending) ?? { since: Date.now(), prompts: [] };
      appendPrompt(batch.prompts, thisPrompt);
      try { writeFileSync(pending, JSON.stringify(batch, null, 2) + "\n"); } catch {}
    }
    console.error("autogit: deferred — another agent is still working in this repo.");
    return null;
  }

  // staging mid-merge/rebase/bisect would wreck it — clean no-op
  if (gitOpInProgress()) {
    console.error("autogit: merge/rebase/bisect in progress — not shipping.");
    return null;
  }

  // quiet batching: record the turn, defer the ship to a detached timer —
  // unless the previous batch already aged past quiet (the backstop).
  if (quietMs > 0 && !flush && !timer && !dryRun) {
    // an empty turn with no batch in flight needs no pending file and no timer
    if (!existsSync(pending) && !thisPrompt && git("status", "--porcelain").out === "") return null;
    // mtime BEFORE this turn's refresh write is the batch's last activity
    const prevMtime = existsSync(pending) ? statSync(pending).mtimeMs : null;
    const batch = readPending(pending) ?? { since: Date.now(), prompts: [] };
    appendPrompt(batch.prompts, thisPrompt);
    writeFileSync(pending, JSON.stringify(batch, null, 2) + "\n");
    if (prevMtime === null || Date.now() - prevMtime < quietMs) {
      spawnQuietTimer(root, quietMs);
      console.error(`autogit: batched — ships after ${quietLabel(config.quiet)} of quiet.`);
      return null;
    }
    // backstop fires: the batch (this turn included) ships right now
  }

  return shipCore(root, config, args, payload, thisPrompt, dryRun);
}

// The shared staging→scan→commit→push core — normal, backstop, timer, flush
// and dry-run all land here.
function shipCore(root, config, args, payload, thisPrompt, dryRun) {
  const mIdx = args.indexOf("-m");
  const message = mIdx !== -1 ? args[mIdx + 1] : null;

  // batch prompts (if any) + this turn's
  const pending = pendingFile();
  const batch = readPending(pending);
  const prompts = batch ? [...batch.prompts] : [];
  if (thisPrompt && hasSecret(thisPrompt)) {
    // deliberate: --force-secrets does NOT override this
    console.error("autogit: prompt looks like it contains a secret — using file-list commit subject.");
  } else {
    appendPrompt(prompts, thisPrompt);
  }

  const add = git("add", "-A");
  if (!add.ok) {
    // an index.lock from another git process is the usual cause — must not
    // masquerade as "nothing changed"
    if (dryRun) { console.error(`autogit (dry run): git add failed:\n${add.all}`); return null; }
    return `git add failed:\n${add.all}`;
  }
  const stagedR = git("diff", "--no-ext-diff", "--cached", "--name-only");
  if (!stagedR.ok) {
    if (dryRun) { console.error(`autogit (dry run): git diff failed:\n${stagedR.all}`); git("reset"); return null; }
    return `git diff failed:\n${stagedR.all}`;
  }
  const staged = stagedR.out.split("\n").filter(Boolean);
  if (!staged.length) {
    if (dryRun) {
      console.error(existsSync(pushFailedFile())
        ? "autogit (dry run): nothing new to ship; an earlier failed push would be retried."
        : "autogit (dry run): nothing to ship.");
      git("reset");
      return null;
    }
    return settleFailedPush(null); // nothing changed — but deliver any stranded push
  }

  if (config.secretsScan && !args.includes("--force-secrets")) {
    const findings = scanSecrets();
    if (findings === null) {
      // the scan itself failed — block; an unscanned diff must never pass
      git("reset");
      if (dryRun) { console.error("autogit (dry run): secrets scan failed — would refuse to ship."); return null; }
      return "secrets scan failed (git diff errored) — refusing to ship; rerun with --force-secrets to override.";
    }
    if (findings.length) {
      git("reset");
      if (dryRun) {
        console.error("autogit (dry run): would BLOCK — possible secrets:");
        for (const f of findings) console.error(`    ${f.file}: ${f.issue}`);
        return null; // dry run always exits 0
      }
      console.error("✗ autogit: blocked — possible secrets in the diff:");
      for (const f of findings) console.error(`    ${f.file}: ${f.issue}`);
      return "fix these, or rerun with --force-secrets.";
    }
  }

  const local = git("rev-parse", "--abbrev-ref", "HEAD").out;
  if (local === "HEAD" && !dryRun) { git("reset"); return "detached HEAD — won't auto-push."; }
  const target = remoteBranchFor(config, local);

  // subject: explicit -m > the LAST worthy prompt in the batch > file list.
  const lastPrompt = prompts.length ? prompts[prompts.length - 1] : null;
  const subject = message || (lastPrompt ? subjectFrom(lastPrompt) : autoMessage(staged));

  if (dryRun) {
    console.error(`autogit (dry run): would commit ${staged.length} file(s):`);
    for (const f of staged) console.error(`    ${f}`);
    console.error(`    subject: "${subject}"`);
    console.error(`    push to: ${config.remote}/${local === "HEAD" ? "(detached HEAD — would fail)" : target}`);
    git("reset"); // dry run never keeps anything staged, never touches pending
    return null;
  }

  // >1 batched prompt → bullet-list body so no turn's intent is lost
  const commitArgs = ["commit", "-m", subject];
  if (prompts.length > 1) commitArgs.push("-m", prompts.map(p => `- ${subjectFrom(p)}`).join("\n"));
  commitArgs.push("-m", SHIP_TRAILER);
  const commit = git(...commitArgs);
  if (!commit.ok) return `commit failed:\n${commit.all}`;

  // the batch is in the commit now — clear pending before the push can fail
  try { unlinkSync(pending); } catch {}

  const push = git("push", config.remote, `HEAD:refs/heads/${target}`);
  if (!push.ok) {
    notePushFailed(config.remote, target, git("rev-parse", "HEAD").out);
    return `push failed (commit kept locally — autogit retries next turn):\n${push.all}`;
  }
  ok(`shipped ${staged.length} file(s) → ${config.remote}/${target}`);

  if (config.pr) managePr(config, local, subject); // best-effort, never fails the ship
  return settleFailedPush({ remote: config.remote, target });
}

// PR mode: keep an open PR from autogit/<branch> into <branch>. Anything gh
// can't do is a note, not a failure — the push already succeeded.
function managePr(config, localBranch, subject) {
  const head = "autogit/" + localBranch;
  const gh = (...a) => spawnSync("gh", a, { encoding: "utf8" });
  const probe = gh("--version");
  if (probe.error || probe.status !== 0) {
    console.error(`autogit: pushed to ${head} — install gh to auto-open PRs.`);
    return;
  }
  const said = r => (r.stderr || r.stdout || "").trim() || "unknown error";
  const list = gh("pr", "list", "--head", head, "--state", "open", "--json", "number");
  if (list.status === 0) {
    try { if (JSON.parse(list.stdout).length) return; } catch {} // open PR exists
  } else {
    console.error(`autogit: push ok; couldn't manage the PR (gh said: ${said(list)})`);
    return;
  }
  const create = gh("pr", "create", "--head", head, "--base", localBranch,
    "--title", subject, "--body", "Automated by autogit.\n\nShipped-by: autogit");
  if (create.status === 0) console.error(`autogit: opened PR for ${head}`);
  else console.error(`autogit: push ok; couldn't manage the PR (gh said: ${said(create)})`);
}

// ---------- undo ----------
// Escape hatch: take back the last autogit commit. Rewinds the remote first
// (only if it still points at the shipped commit), then undoes the local
// commit, leaving the changes uncommitted in the working tree.
// Run it again to peel off earlier autogit commits one at a time.

function cmdUndo() {
  const root = repoRootOrNull();
  if (!root) die("not inside a git repository.");
  process.chdir(root);

  const head = git("rev-parse", "HEAD");
  if (!head.ok) die("no commits in this repo.");
  const subject = git("log", "-1", "--format=%s").out;
  const body = git("log", "-1", "--format=%B").out;
  // legacy "autogit:" prefix covers commits made before the trailer existed
  if (!body.includes(SHIP_TRAILER) && !subject.startsWith("autogit:"))
    die(`last commit ("${subject}") wasn't made by autogit — won't touch it.`);

  const parent = git("rev-parse", "HEAD~1");
  if (!parent.ok) die("the autogit commit is the repo's only commit — undo it manually.");

  const local = git("rev-parse", "--abbrev-ref", "HEAD").out;
  if (local === "HEAD") die("detached HEAD — undo manually.");

  // config may be gone (autogit off) — undo still works, with defaults.
  // But a CORRUPT config must die: silently falling back to defaults would
  // rewind the wrong remote branch in PR mode (and leave the PR branch up).
  let config = DEFAULTS;
  const found = findConfig(root);
  if (found) {
    try { config = { ...DEFAULTS, ...JSON.parse(readFileSync(found.path, "utf8")) }; }
    catch { die(`${found.path} is not valid JSON — fix it first (it decides which remote branch gets rewound).`); }
  }
  // PR mode shipped to autogit/<branch> — rewind that same ref
  const target = remoteBranchFor(config, local);

  // rewind the remote first, while local HEAD still matches what was pushed
  const fetch = git("fetch", config.remote, target);
  if (fetch.ok) {
    const remoteTip = git("rev-parse", "FETCH_HEAD").out;
    if (remoteTip === head.out) {
      const push = git("push", `--force-with-lease=${target}:${head.out}`,
        config.remote, `${parent.out}:refs/heads/${target}`);
      if (!push.ok) die(`couldn't rewind ${config.remote}/${target}:\n${push.all}`);
      ok(`rewound ${config.remote}/${target} to ${parent.out.slice(0, 7)}`);
    } else if (remoteTip !== parent.out) {
      die(`${config.remote}/${target} no longer matches the shipped commit — undo manually.`);
    } // remoteTip === parent → the commit was never pushed; local undo only
  } else if (/couldn't find remote ref/i.test(fetch.all)) {
    // branch never reached the remote — local undo only
  } else {
    die(`could not reach ${config.remote} — fix the connection and rerun:\n${fetch.all}`);
  }

  git("reset", parent.out); // mixed reset: the changes come back, uncommitted
  ok(`undid "${subject}" — changes are back (uncommitted) in your working tree.`);
}

// ---------- status ----------

function cmdStatus() {
  console.log(`autogit ${VERSION}`);
  const claudeFile = path.join(homedir(), ".claude", "settings.json");
  const claudeWired = existsSync(claudeFile) && readFileSync(claudeFile, "utf8").includes("autogit ship");
  const codexFile = path.join(homedir(), ".codex", "hooks.json");
  const codexWired = existsSync(codexFile) && readFileSync(codexFile, "utf8").includes("autogit ship");
  const cursorFile = path.join(homedir(), ".cursor", "hooks.json");
  const cursorWired = existsSync(cursorFile) && readFileSync(cursorFile, "utf8").includes("autogit ship");
  const piWired = existsSync(path.join(homedir(), ".pi", "agent", "extensions", "autogit.ts"));
  console.log(`hooks:  Claude Code ${claudeWired ? "wired" : "NOT wired"} · Codex ${codexWired ? "wired" : "NOT wired"} · Cursor ${cursorWired ? "wired" : "NOT wired"} · Pi ${piWired ? "wired" : "NOT wired"}`);

  const root = repoRootOrNull();
  if (!root) { console.log("repo:   not inside a git repository"); return; }
  process.chdir(root);
  const found = findConfig(root);
  console.log(`repo:   ${root}`);
  console.log(`        auto-push ${found ? "ON" : "OFF — run: autogit on"}`);
  if (found) {
    let cfg = {}, badCfg = false;
    try { cfg = JSON.parse(readFileSync(found.path, "utf8")); } catch { badCfg = true; }
    console.log(`        config: ${found.legacy ? `legacy ${LEGACY_CONFIG_FILE} — run "autogit on" to migrate` : found.path}`);
    if (badCfg) console.log(`        config is INVALID JSON — every ship is failing; fix ${found.path}`);
    const extras = [];
    if (cfg.quiet) extras.push(`quiet: ${quietLabel(cfg.quiet)}`);
    if (cfg.pr) extras.push("pr: on");
    if (extras.length) console.log(`        ${extras.join(" · ")}`);
    const pending = pendingFile();
    if (existsSync(pending)) {
      const n = readPending(pending)?.prompts.length ?? 0;
      console.log(`        pending: ${n} turn(s) batched — ships after ${quietLabel(cfg.quiet ?? 0)} of quiet`);
    }
    if (existsSync(pushFailedFile()))
      console.log(`        push:   an earlier push FAILED — autogit retries on the next turn (or run: autogit ship)`);
  }

  const dir = busyDir();
  const fresh = existsSync(dir)
    ? readdirSync(dir).filter(f => Date.now() - statSync(path.join(dir, f)).mtimeMs <= BUSY_TTL_MS)
    : [];
  if (fresh.length) console.log(`        busy: ${fresh.length} agent(s) mid-turn — shipping deferred`);
}

// ---------- main ----------

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case "setup": cmdSetup(); break;
  case "teardown": cmdTeardown(); break;
  case "on": cmdOn(); break;
  case "off": cmdOff(); break;
  case "ship": cmdShip(args); break;
  case "undo": cmdUndo(); break;
  case "busy": cmdBusy(args); break;
  case "status": cmdStatus(); break;
  case "-v": case "--version": console.log(VERSION); break;
  default:
    console.log(`autogit — auto stage→commit→push for agentic engineers

  autogit setup     Wire up agent hooks: Claude Code + Codex + Cursor + Pi (once per machine)
  autogit teardown  Unwire the agent hooks again (per-repo configs stay)
  autogit on        Enable auto-push in this repo
  autogit off       Disable auto-push in this repo
  autogit ship      Stage, scan, commit, push (hooks run this after every turn)
  autogit undo      Take back the last autogit commit, local + remote (repeatable)
  autogit busy      Mark this repo busy (agent start/tool hooks run this)
  autogit status    Show hooks + repo state
  autogit --version Print the installed version (-v)

ship flags:
  -m "message"      Commit message (defaults to the turn's prompt, else the file list)
  --force-secrets   Override a secrets-scan block
  --dry-run         Report what would ship (stages + resets, commits nothing)
  --flush           Ship any quiet-batched turns right now

Config keys "quiet" (debounced batching, e.g. "5m") and "pr" (push to
autogit/<branch> + auto-open a PR) go in the repo config — see the README.

Parallel agents in one repo: ship defers while another agent is mid-turn;
the last one to finish ships everything. Use worktrees for full isolation.`);
}
