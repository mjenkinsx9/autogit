# Installation & Quick Start

## Claude Code — install as a plugin (recommended)

```
/plugin marketplace add mjenkinsx9/mjenkins-toolbox
/plugin install autogit@mjenkins-toolbox
```

The plugin wires the hooks automatically — no `autogit setup`, no edits to `~/.claude/settings.json`, and disabling the plugin unwires everything. Then opt in per repo:

```
/autogit on
```

(`/autogit status`, `/autogit undo`, `/autogit off`, `/autogit flush`, and `/autogit dry-run` are also available.) Requires `node` on PATH — without it the hooks silently no-op.

## Any agent — install the CLI

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
> This fork is **not published to npm** — it installs from source (the `npm link` above) or via the marketplace plugin. The upstream npm package (`@davidondrej/autogit`) is David Ondrej's separate original 0.4.x.

macOS and Linux. Windows is unsupported — the hook commands are POSIX shell.

## Supported agents

| Agent | After `autogit setup` |
| --- | --- |
| **Claude Code** | works immediately — or skip `setup` entirely and use the plugin (see Quick start) |
| **Cursor** | works immediately — local + worktree agents (cloud agents don't fire stop hooks yet) |
| **Pi** | works immediately |
| **Codex** | one-time approval: restart open sessions, then run `/hooks` in `codex` and trust autogit (needs ≥ 0.124) — covers the CLI, the Codex desktop app, and the IDE extension |

> Hooks fire for local agent sessions. Delegated/cloud runs (Cursor cloud agents, Codex cloud tasks) and `codex exec` don't fire them yet — upstream limitations. Codex re-asks for `/hooks` trust whenever autogit updates its hook entries.

---

Back to the documentation index: [README.md](README.md)
