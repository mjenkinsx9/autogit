<div align="center">

# 🚢 autogit

### Your AI coding agent writes the code — autogit ships it

**When your agent finishes a turn, autogit stages, scans, commits, and pushes. Automatically. Claude Code, Codex, Cursor, and Pi.**

[![CI](https://github.com/mjenkinsx9/autogit/actions/workflows/ci.yml/badge.svg)](https://github.com/mjenkinsx9/autogit/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=nodedotjs&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-zero-blue)
![Tests](https://img.shields.io/badge/tests-83_passing-brightgreen)
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
| 🔐 | **Secrets gate** | Pattern scan over the staged diff blocks the push and unstages — fail-closed |
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
cd your-project && autogit on
```

`setup` wires the lifecycle hooks for every agent it finds — Claude Code, Codex, Cursor, and Pi. Every agent turn in an opted-in repo now ships. Repos without `autogit on` are never touched.

macOS and Linux. Windows is unsupported — the hook commands are POSIX shell. Full install paths, the double-wiring guard, and per-agent notes are in [docs/02-installation.md](docs/02-installation.md).

## 📚 Documentation

Full guides, configuration, and internals live in [`docs/`](docs/README.md).

| Doc | Description |
| --- | --- |
| [Overview](docs/01-overview.md) | What autogit is, the feature set, and platform support |
| [Installation & Quick Start](docs/02-installation.md) | Install as a plugin or the CLI, opt in per repo, supported agents |
| [Commands](docs/03-commands.md) | Every command, `ship` flags, commit-message rules, and undo |
| [Batching & PR Mode](docs/04-batching-and-pr-mode.md) | Quiet batching (`quiet`) and PR mode (`pr`) |
| [Configuration](docs/05-configuration.md) | `autogit.json` keys and defaults |
| [Safety](docs/06-safety.md) | Opt-in model, secrets scan, undo, merge/rebase guard |
| [Install Across Harnesses](docs/07-harness-install.md) | Per-harness plugin manifests and auto-ship hooks |
| [Internals](docs/08-internals.md) | Design, how `ship`/`undo`/batching work, busy markers, fail-safes |

Full documentation map: [docs/README.md](docs/README.md)

## 📄 License

[MIT](LICENSE) — original work © David Ondrej, modifications © Mike Jenkins.
