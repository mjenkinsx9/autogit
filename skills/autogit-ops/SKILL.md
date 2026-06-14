---
name: autogit-ops
description: Run the bundled autogit CLI (auto stage → secrets-scan → commit → push). Use when the user invokes /autogit or asks to enable, disable, undo, flush, or inspect autogit auto-push in the current repo.
---

# autogit ops

This skill ships inside the autogit plugin. This file lives at
`<plugin-root>/skills/autogit-ops/SKILL.md`, so the bundled zero-dependency
CLI is two directories up: `<plugin-root>/index.js`. Resolve `<plugin-root>`
from this file's own absolute path. Never assume a global `autogit` binary —
always run the bundled one:

```bash
node "<plugin-root>/index.js" <subcommand>
```

Run it from the repo the user means (their project directory, not the plugin
directory).

## Dispatch

| Argument | Run | Notes |
|---|---|---|
| `on` | `node .../index.js on` | Enables auto-push for this repo (writes `.git/autogit.json`). After it succeeds, tell the user this repo is now opted in — every turn ends with stage → secrets scan → commit → push **once autogit's lifecycle hooks are wired for the agent you're running**. The Claude Code plugin wires them automatically, so there `on` is all that's needed; on other harnesses (Cursor, Codex, Factory, Gemini) the hooks come from a one-time `autogit setup` (`node .../index.js setup`). If `setup` hasn't run on a non-Claude agent, `on` only writes the config and turns won't ship until the hooks exist. `quiet` and `pr` config keys go in `.git/autogit.json`. |
| `off` | `node .../index.js off` | Disables auto-push for this repo. |
| `status` (default) | `node .../index.js status` | Also the no-args behavior. Surface pending batches and failed-push lines prominently if present. |
| `undo` | `node .../index.js undo` | Rewinds the last autogit commit on the remote and locally; changes return uncommitted. Repeatable. It refuses non-autogit commits on its own — no extra confirmation needed. |
| `ship` | `node .../index.js ship` | Ship right now (stage → scan → commit → push). |
| `flush` | `node .../index.js ship --flush` | Ship a pending quiet batch immediately. |
| `dry-run` | `node .../index.js ship --dry-run` | Report what would ship; commits nothing. Note: like ship, it runs `git add -A` + `git reset`, clearing any manual staging selection. |

## Behavior notes

- All human-readable output is on **stderr**; exit 0 = success or clean no-op,
  exit 1 = real failure. Relay the CLI's own message to the user rather than
  paraphrasing loosely.
- If `node` is missing from PATH, say so — the plugin's automatic hooks
  silently no-op without Node, so nothing has been shipping.
- Automatic ship-after-every-turn depends on autogit's lifecycle hooks being
  wired for the running agent. The **Claude Code plugin** wires them itself, so
  there `on` per repo is all that's needed. On **every other** harness (Cursor,
  Codex, Factory Droid, Gemini) this plugin supplies the `/autogit` control
  surface, but the automatic shipping comes from a one-time `autogit setup`
  (`node .../index.js setup`), not from the plugin. If a user on a non-Claude
  agent runs `on` and turns still aren't shipping, check that `autogit setup`
  has been run.
- If the user asks for anything else (custom commit message, force past a
  secrets block), the flags are `-m "msg"` and `--force-secrets` on `ship`.
