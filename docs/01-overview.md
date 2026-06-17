# Overview

autogit wires itself into your agents' lifecycle hooks once, per machine. After that, every agent turn in an opted-in repo ends with **stage → secrets scan → commit → push** — and `git log` reads like the instructions you gave your agent, because the turn's prompt becomes the commit subject.

> **Credit:** autogit began as [davidondrej/autogit](https://github.com/davidondrej/autogit) by David Ondrej — all credit to him for the idea and the original MVP. This repo is a heavily reworked fork (v0.5.0): per-clone config that can't leak to teammates, fail-closed safety, quiet batching, PR mode, and a full test suite.

## What's inside

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

## Platform support

macOS and Linux. Windows is unsupported — the hook commands are POSIX shell.

---

Back to the documentation index: [README.md](README.md)
