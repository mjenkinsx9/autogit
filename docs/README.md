# autogit documentation

**Start here:** [Overview](01-overview.md) — what autogit is and what's inside.

## Getting started

| Doc | Description |
| --- | --- |
| [Overview](01-overview.md) | What autogit is, the feature set, and platform support |
| [Installation & Quick Start](02-installation.md) | Install as a Claude Code plugin or the CLI, opt in per repo, supported agents |

## Using it

| Doc | Description |
| --- | --- |
| [Commands](03-commands.md) | Every command, `ship` flags, commit-message rules, and undo |
| [Batching & PR Mode](04-batching-and-pr-mode.md) | Quiet batching (`quiet`) and PR mode (`pr`) |
| [Configuration](05-configuration.md) | `autogit.json` keys and defaults |
| [Safety](06-safety.md) | Opt-in model, secrets scan, undo, merge/rebase guard, parallel-agent rules |

## Reference

| Doc | Description |
| --- | --- |
| [Internals](08-internals.md) | Design decisions, how `ship`/`undo`/batching work, busy markers, fail-safes |
| [Install Across Harnesses](07-harness-install.md) | Per-harness plugin manifests, control surfaces, and auto-ship hooks |
| [autogit on Gemini CLI](gemini.md) | Gemini extension (skill) + the auto-ship template, and why auto-ship is blocked |
| [autogit on OpenCode](opencode.md) | Reference plugin (unvalidated) and how the events map |

## Project & meta

| Doc | Description |
| --- | --- |
| [Development](09-development.md) | Running tests and CI |
| [Roadmap](10-roadmap.md) | Owner-gated future work |
| [AGENTS.md](../AGENTS.md) | How agents should work here: response style, working rules, release process |
