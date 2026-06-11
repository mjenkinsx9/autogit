---
description: >
  Control autogit (auto stage → secrets-scan → commit → push) in this repo.
  Subcommands: on (enable auto-push here), off (disable), status (hooks +
  repo state), undo (take back the last autogit commit, local + remote),
  ship (ship now), flush (ship a pending quiet batch now), dry-run (preview
  what would ship).
argument-hint: "[on|off|status|undo|ship|flush|dry-run]"
---

The user invoked autogit with: $ARGUMENTS

Invoke the `autogit-ops` skill (Skill tool, name `autogit:autogit-ops`) and
follow its dispatch table with these arguments. The skill knows how to locate
the bundled autogit CLI inside this plugin — do not assume an `autogit`
command is on PATH.

Quick reference:
- `on` / `off` → enable / disable auto-push in the current repo
- `status` → wiring + repo state (config, pending batches, failed pushes)
- `undo` → rewind the last autogit commit (remote + local); repeatable
- `ship` / `flush` / `dry-run` → ship now / flush a quiet batch / preview only
- (no args) → `status`
