<div align="center">

# 🚢 autogit

### Your AI coding agent writes the code — autogit ships it

**When your agent finishes a turn, autogit stages, scans, commits, and pushes. Automatically. Claude Code, Codex, Cursor, and Pi.**

[![CI](https://github.com/mjenkinsx9/autogit/actions/workflows/ci.yml/badge.svg)](https://github.com/mjenkinsx9/autogit/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-zero-blue)
![Tests](https://img.shields.io/badge/tests-73_passing-brightgreen)
![Agents](https://img.shields.io/badge/agents-Claude_Code_%7C_Codex_%7C_Cursor_%7C_Pi-d97757)
![Platform](https://img.shields.io/badge/platform-macos%20%7C%20linux-lightgrey)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

</div>

---

autogit wires itself into your agents' lifecycle hooks once, per machine. After that, every agent turn in an opted-in repo ends with **stage → secrets scan → commit → push** — and `git log` reads like the instructions you gave your agent, because the turn's prompt becomes the commit subject.

> **Credit:** autogit began as [davidondrej/autogit](https://github.com/davidondrej/autogit) by David Ondrej — all credit to him for the idea and the original MVP. This repo is a heavily reworked fork (v0.5.0): per-clone config that can't leak to teammates, fail-closed safety, quiet batching, PR mode, and a full test suite.

## ✨ What's inside

| | Feature | What it does |
|---|---|---|
| 🚢 | **Auto-ship** | Every agent turn ends with stage → scan → commit → push — zero ceremony |
| ✉️ | **Prompts as commit messages** | The subject is what you asked your agent to do; "yes"-type replies and slash commands never make it in |
| 🔐 | **Secrets gate** | Pattern scan over the staged diff (Anthropic, OpenAI, AWS, GitHub, GitLab, Stripe, npm, Slack, Google, key files, JWTs…) blocks the push and unstages — fail-closed |
| ↩️ | **One-command undo** | `autogit undo` rewinds the remote *and* the local commit, leaving your changes back in the working tree |
| ⏱️ | **Quiet batching** | `"quiet": "5m"` accumulates turns and ships one commit after the repo goes quiet |
| 🔀 | **PR mode** | `"pr": true` pushes to `autogit/<branch>` and auto-opens a pull request via `gh` |
| 🤝 | **Parallel-agent aware** | Busy markers make simultaneous agents take turns; worktrees stay fully isolated |
| 🛡️ | **Fail-safe by design** | Hooks never disturb the agent; failed pushes are remembered and retried; merge/rebase states are never touched |

## 🚀 Quick start

### Claude Code — install as a plugin (recommended)

```
/plugin marketplace add mjenkinsx9/mjenkins-toolbox
/plugin install autogit@mjenkins-toolbox
```

The plugin wires the hooks automatically — no `autogit setup`, no edits to `~/.claude/settings.json`, and disabling the plugin unwires everything. Then opt in per repo:

```
/autogit on
```

(`/autogit status`, `/autogit undo`, `/autogit off`, `/autogit flush`, and `/autogit dry-run` are also available.) Requires `node` on PATH — without it the hooks silently no-op.

### Any agent — install the CLI

```bash
git clone https://github.com/mjenkinsx9/autogit && cd autogit && npm link
autogit setup
```

`setup` wires the lifecycle hooks for every agent it finds — Claude Code, Codex, Cursor, and Pi. Run `autogit teardown` any time to unwire them all. Then enable per repo:

```bash
cd your-project
autogit on
```

Done. Every agent turn in this repo now ships. Repos without `autogit on` are never touched.

> Don't double up: if you install the Claude Code plugin AND run `autogit setup`, the plugin detects the global wiring and stands down, so turns never ship twice.
>
> The upstream npm package (`@davidondrej/autogit`) is the original 0.4.x — this fork's hardened build is install-from-source until it's published.

macOS and Linux. Windows is unsupported — the hook commands are POSIX shell.

## 🤖 Supported agents

| Agent | After `autogit setup` |
| --- | --- |
| **Claude Code** | works immediately — or skip `setup` entirely and use the plugin (see Quick start) |
| **Cursor** | works immediately — local + worktree agents (cloud agents don't fire stop hooks yet) |
| **Pi** | works immediately |
| **Codex** | one-time approval: restart open sessions, then run `/hooks` in `codex` and trust autogit (needs ≥ 0.124) — covers the CLI, the Codex desktop app, and the IDE extension |

> Hooks fire for local agent sessions. Delegated/cloud runs (Cursor cloud agents, Codex cloud tasks) and `codex exec` don't fire them yet — upstream limitations. Codex re-asks for `/hooks` trust whenever autogit updates its hook entries.

## 📟 Commands

```
autogit setup     Wire up agent hooks (once per machine)
autogit teardown  Remove all global agent hooks (per-repo configs untouched)
autogit on        Enable auto-push in this repo
autogit off       Disable auto-push in this repo
autogit ship      Stage, scan, commit, push (what the hooks run)
autogit undo      Take back the last autogit commit, local + remote
autogit status    Show hooks + repo state (including pending batches)
autogit --version Print the installed version (-v)
```

**`ship` flags**: `-m "message"` sets the commit subject. `--force-secrets` pushes past a diff-scan block. `--dry-run` runs the whole pipeline — stages, scans, computes the subject and push target — then reports what would happen and unstages everything. Note: dry-run (like `ship` itself) runs `git add -A` + `git reset`, so it clears any manual staging selection. `--flush` ships a pending batch immediately (see Batching below).

**Commit messages**: `autogit ship -m "message"` uses your message. Without `-m`, the subject is the prompt you gave your agent that turn (so `git log` reads like your instructions), falling back to a list of changed files. Two filters apply: a prompt that looks like it contains a secret (pasted API key, token, etc.) is never used — not overridable — and a prompt that wouldn't make a useful subject (short "yes"/"ok"-type replies, slash commands) is skipped for the next candidate, ultimately the file list.

**Undo**: shipped something you regret? `autogit undo` rewinds the remote branch, removes the commit locally, and leaves the changes uncommitted in your working tree — ready to fix and re-ship. Run it again to peel off earlier autogit commits. It refuses to touch commits it didn't make, or remotes that have since moved on.

## ⏱️ Batching

By default every turn ships. Set `quiet` in the config to batch instead:

```json
{ "mode": "auto", "quiet": "5m" }
```

Turns accumulate, and autogit ships once the repo has been quiet — no agent turn ended — for that long. One commit: the subject is the last prompt, the body lists all of them. Values are seconds, or strings like `"90s"` / `"5m"`.

`autogit ship --flush` ships any pending batch (plus uncommitted changes) right now, skipping the wait. `autogit status` shows pending batches.

No daemon: each turn spawns a short-lived detached timer, and if a timer ever dies the next ship notices the aged batch and flushes it as a backstop.

## 🔀 PR mode

Set `pr: true` and autogit pushes to `autogit/<branch>` instead of `<branch>`. If `gh` is installed, it auto-opens a pull request (and leaves an already-open one alone on later ships); without `gh` the push still lands, with a note. `autogit undo` rewinds the PR branch. Your local branch still carries the commits — the PR branch is just where they're pushed. (Undo reads the config to know which branch to rewind, so undo a PR-mode ship *before* running `autogit off`.)

PR mode and `quiet` compose freely.

## ⚙️ Configuration

`autogit on` writes `autogit.json` into the git common dir — `.git/autogit.json` in a normal clone, shared by all linked worktrees. All keys, with defaults:

```json
{
  "mode": "auto",
  "remote": "origin",
  "branch": "current",
  "secretsScan": true,
  "quiet": 0,
  "pr": false
}
```

## 🛡️ Safety

- **Opt-in per repo** — repos without `autogit on` are never touched. Config lives in the git dir (`.git/autogit.json`), never committed — enabling autogit can't silently opt in your teammates. (A legacy root `.autogit.json` is still honored; `autogit on` migrates it.)
- **No silent losses** — a failed push leaves a marker and is retried on later turns (`status` shows it); a failed or blinded secrets scan blocks instead of passing; a failed `git add` is a visible error, not "nothing changed".
- **One-command undo** — `autogit undo` takes back the last auto-push, remote included.
- **Merge/rebase guard** — mid-merge, mid-rebase, mid-cherry-pick, or mid-bisect repos are never shipped.
- **Secrets scan** — blocks pushes containing Anthropic, OpenAI, AWS, GitHub (classic + fine-grained), GitLab, Stripe, npm, SendGrid, Twilio, Slack, or Google keys, private key blocks, JWTs, and sensitive files (`.npmrc`, `.pypirc`, `.env*`, key files) — and unstages everything. Override with `--force-secrets`. Commit messages are covered too: a prompt containing a secret never becomes the subject (not overridable). It's a pattern-based screen, not a guarantee — for high-stakes repos, run a dedicated scanner as well.
- **No noise** — nothing changed means nothing shipped. Aborted or errored Cursor turns never ship.
- **Parallel-agent aware** — if another agent is still mid-task in the same repo, autogit waits its turn: the last agent to finish ships everything. (For fully separate commits per agent, use worktrees — autogit handles each independently.)

## 🧪 Development

```bash
npm test    # node --test test/*.test.js
```

Node 18+, zero dev dependencies — tests use the built-in `node:test` runner (73 tests). CI runs them on Node 18/20/22 across Linux and macOS.

## 🔧 Internals

For contributors, human or AI. The implementation is a reference of product intent, not fixed architecture.

### Design

- Single zero-dependency Node.js CLI: `index.js`, ESM, Node ≥18.
- Commands: `setup`, `teardown`, `on`, `off`, `ship`, `undo`, `busy`, `status`, plus `-v`/`--version` (read from `package.json`, also shown by `status`).
- One mode for now (DECIDED 2026-06-10): **auto** — ship immediately, no review gate. Review modes are on the roadmap.
- npm name (DECIDED 2026-06-10, upstream): **`@davidondrej/autogit`** — unscoped `autogit`/`autogit-cli` taken; `auto-git` rejected by npm's name-similarity rule. The installed binary stays `autogit`. Scoped packages need `npm publish --access=public`. This fork is unpublished; a rename is needed before publishing.
- Per-repo opt-in is the safety model: `autogit on` writes the config; without it, `ship` is a silent no-op (exit 0). Only enable it where aggressive auto-push is OK.
- Config lives at `<git-common-dir>/autogit.json` (DECIDED 2026-06-11): the old root `.autogit.json` was contagious — `git add -A` committed it, so one user running `autogit on` silently enabled auto-push for every collaborator who'd run `setup`. The git dir can't be committed. Common dir = one config per clone, shared by all worktrees. Legacy root files are still read (with a stderr nudge on ship); `autogit on` deletes and migrates them — and warns if the legacy file was tracked, since its deletion ships with the next turn. `autogit off` deletes both locations.
- Exit-code contract (DECIDED 2026-06-11, now explicit): 0 = shipped or clean no-op; 1 = real failure (bad config JSON, secrets block, commit/push failure, detached HEAD, undo failures); NEVER 2. All human output on stderr, except `status`/`setup`/`teardown`/help/version reports on stdout.
- Multi-root ships (DECIDED 2026-06-11): a failure in one workspace root doesn't abort the others — every root runs, each error is printed, exit 1 at the end if any failed.
- Merge/rebase guard (DECIDED 2026-06-11): before staging, `ship` no-ops (exit 0) if the per-worktree git dir contains `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`, `rebase-apply`, or `rebase-merge`.
- One helper, `remoteBranchFor(config, localBranch)`, decides the push target for both `ship` and `undo`: `autogit/<branch>` in PR mode, otherwise the configured or current branch.
- `autogit setup` wires lifecycle hooks globally: Claude Code `Stop` (`~/.claude/settings.json`), Codex `Stop` (`~/.codex/hooks.json`, ≥0.124, one-time `/hooks` trust), Cursor `stop` (`~/.cursor/hooks.json`, lowercase events + `version: 1`), and a Pi extension (`~/.pi/agent/extensions/autogit.ts`, fires on `agent_end`). All JSON configs merge through one helper; Claude/Codex share the same `Stop` entry shape.
- `autogit teardown` (added 2026-06-11) reverses `setup` for all four agents: filters autogit entries out of the JSON hook configs, and deletes the Pi extension only if its content is recognizably ours. Idempotent; per-repo configs are untouched.
- Claude Code plugin wrapper (DECIDED 2026-06-12, same repo — a separate plugin repo would just hold a drifting copy of `index.js`): `.claude-plugin/plugin.json` + `hooks/hooks.json` (Stop → `hooks/ship.sh`, UserPromptSubmit/PostToolUse → `hooks/busy.sh`) + `commands/autogit.md` → `skills/autogit-ops/SKILL.md` (anchor-style dispatch — `${CLAUDE_PLUGIN_ROOT}` expands in hook commands but NOT in command markdown, so the skill resolves the plugin root from its own file path). The hook scripts are fail-soft (no `node` on PATH → silent exit 0) and stand down when `~/.claude/settings.json` already contains `autogit ship`/`autogit busy` entries from a global `setup` (double-wiring guard). Distributed via the mjenkins-toolbox marketplace; npm `files` whitelist keeps plugin dirs out of any npm publish; `plugin.json` version must match `package.json` (tested).
- Codex legacy `notify` is NOT used (single-slot, often taken by other tools; an upstream deprecation was attempted and reverted in 0.129). Codex hook commands run in the session `cwd`, unsandboxed, via `$SHELL -lc` — so `git push` has network and the user's PATH.
- Codex surfaces (verified 2026-06-10): the desktop app and IDE extension run the same CLI core and execute the same `~/.codex/hooks.json`; cloud tasks never fire local hooks, and `codex exec` hook dispatch is broken upstream (openai/codex#26452). Trust is hash-based — any change to the wired commands silently un-trusts them until the user re-runs `/hooks`; editing hooks.json mid-session disables hooks until Codex restarts (#21160). Esc-interrupted turns fire no `Stop`; that turn's changes ship with the next one (busy-marker TTL self-heals).
- `ship` reads an optional JSON payload from stdin (all hook systems pipe one): Cursor's carries `workspace_roots` (its hooks run from `~/.cursor`, not the project — multi-root workspaces ship every opted-in root) and `status` (`ship` only proceeds on `completed`, so aborted/errored turns never push). Claude/Codex payloads lack these fields and fall through to cwd behavior.

### How `ship` works

Merge/rebase guard → `git add -A` → secrets scan on added lines (the full key list in Safety above; `--force-secrets` overrides) → commit → push to the target from `remoteBranchFor` (current branch by default, `autogit/<branch>` in PR mode).

Commit subject precedence: `-m` flag > the turn's user prompt > the agent's final message (Codex `last_assistant_message`) > file-list fallback (`autogit: update X, Y (+N more)`). Every prompt-derived candidate passes `promptWorthy` first (added 2026-06-11): under 12 chars, slash commands, and "yes"/"ok"/"lgtm"-type acknowledgements never become subjects — the chain falls through to the next candidate. Candidates are also checked against `SECRET_PATTERNS` (full text, pre-truncation — the diff scan never sees the message): a match drops to the file-list fallback, with a stderr note. `--force-secrets` deliberately does not override this. The prompt comes from the session's busy-marker content (see below), or a `prompt`-like field in the stop payload, or the last real user message in the `transcript_path` JSONL — both Claude transcript and Codex rollout line shapes are parsed (formats are officially unstable, so parsing is defensive; tool results and `<`-prefixed noise like `<user_instructions>` are skipped). Subjects are flattened to one line, capped at 72 chars. Every commit gets a `Shipped-by: autogit` trailer — that's how `undo` identifies autogit commits.

### Batching (`quiet`)

- Pending state lives at `<git-dir>/autogit-pending.json` (per-worktree, same resolution as busy markers): first-pending timestamp + the accumulated worthy prompts (secret-bearing prompts are never stored). File mtime = last activity.
- Each turn appends to the pending file and spawns a detached `ship --timer <ms>` child (`stdio: "ignore"`, unref'd). The timer wakes after the quiet window plus grace, exits silently if newer activity refreshed the file (a newer timer exists) or another agent is busy, otherwise ships the batch.
- Backstop: if a batch has already aged past the quiet window when the next turn's ship runs (all timers died — reboot, kill), that ship flushes it immediately, including the new turn.
- Batch commit: subject = last worthy prompt (or `-m`, or file list); >1 prompt adds a body bulleting all prompts (flattened, 72-char cap each) above the `Shipped-by: autogit` trailer. The pending file is deleted right after a successful commit, before the push.
- `--flush` is the user-facing immediate ship; `--dry-run` reports what a flush would do without touching the pending file.

### How `undo` works

Escape hatch for bad auto-pushes; one commit per run, repeatable. Refuses unless the last commit has the `Shipped-by: autogit` trailer (or legacy `autogit:` subject prefix). Order matters: it rewinds the remote first (`push --force-with-lease` of the parent, only if the remote tip still equals the shipped commit), then `git reset <parent>` (mixed) locally so the changes land back in the working tree uncommitted. Remote tip == parent means the push never landed → local-only undo. Remote moved past the commit → die, undo manually. Works even after `autogit off` (falls back to default remote `origin`). In PR mode the same logic targets `autogit/<branch>` via `remoteBranchFor`.

### Parallel agents (busy markers)

- Problem: `git add -A` would scoop up a second agent's half-finished work when the first agent's turn ends.
- Solution: while an agent is mid-turn it holds a marker file in `<git-dir>/autogit-busy/<session-id>`. `ship` clears its own marker, then defers (exit 0, stderr note) if any other fresh marker exists. The last agent to finish ships everything. No polling, no daemon.
- Markers are written/refreshed by `autogit busy`, wired to: Claude `UserPromptSubmit` + `PostToolUse`, Codex `UserPromptSubmit` + `PostToolUse`, Cursor `beforeSubmitPrompt` + `postToolUse`, Pi `agent_start` + `tool_execution_end`. Tool hooks refresh the marker so long turns stay fresh.
- Marker content doubles as prompt storage: prompt-submit hooks carry the user's prompt, so `busy` writes it into the marker; tool hooks carry none, so they only bump mtime (preserving the content). `ship` reads its own marker before clearing it and uses the prompt as the commit subject. Pi's hooks don't expose the prompt — Pi ships with the file-list fallback.
- Stale markers (> 15 min, `BUSY_TTL_MS`) mean a crashed agent — they're deleted on sight, so shipping self-heals.
- Markers live under the *resolved* git dir (`git rev-parse --git-dir`), so each worktree has its own set — parallel worktree agents never block each other.
- `autogit busy` must stay silent on stdout (some hooks parse stdout). Session ids come from hook payloads (`session_id`/`conversation_id`/`thread_id`/`turn_id`) or `--id` (Pi). No id → no marker (an unattributable marker can never be cleared by its owner and would block shipping until stale).
- Limit: simultaneous agents in ONE directory still end up in one blended commit (shipped by the last finisher). True isolation = worktrees.

### Fail-safes

- Hooks must never disturb the agent: `ship` exits 0 on every no-op path, and never exits 2 (Claude would block its Stop hook; Codex would treat stderr as instructions and *continue the turn*). All output goes to stderr — Codex parses Stop-hook stdout as JSON and injects UserPromptSubmit stdout into model context.
- Mid-merge/rebase/cherry-pick/bisect repos are a clean no-op — hooks come back untouched.
- Secrets scan blocks the push and fully unstages (`git reset`).
- `autogit undo` reverses a bad ship — remote rewind + local uncommit, never touches non-autogit commits.
- Failed-push recovery (DECIDED 2026-06-11): the quiet timer runs detached with discarded stderr, so a push failure there would otherwise be invisible and never retried. A failed push writes `<git-dir>/autogit-push-failed.json` (remote, target, SHA); every later ship retries it (pushing the recorded SHA, not HEAD — the user may have switched branches), a successful push to the same destination settles it, and `status` reports it. Secrets scanning is likewise fail-closed: the diff runs with `--no-ext-diff` (external diff tools emit no `+` lines and would blind the scan) and a scan whose git commands fail blocks the ship instead of passing it.
- Nothing staged → no commit, no push, no noise.
- Multi-root ships keep going past a failed root; the exit code reports the failure at the end.

## 🗺️ Roadmap

Owner-gated — don't build these without a go-ahead.

- **agent mode** — an LLM reviews the diff before push, for more serious repos. Owner decision 2026-06-09 (upstream): the *currently-running* agent should review (it has task context), not a separate OpenRouter call. Mechanics TBD.
- **human mode** — terminal y/n prompt on the diff, for production repos. (Existed in the pre-MVP prototype, cut for focus.)
- More agents in `setup` (Pi added 2026-06-10; Hermes next: `post_llm_call` shell hook in `~/.hermes/config.yaml` + reading `cwd` from stdin JSON in `ship` + user consent flow).
- Richer PR flows — basic PR mode shipped in 0.5.0 (push to `autogit/<branch>` + auto-open via `gh`); deeper PR integration considered.

## 📄 License

[MIT](LICENSE) — original work © David Ondrej, modifications © Mike Jenkins.
