#!/usr/bin/env bash
# Claude Code Stop hook (plugin wiring): ship the turn via the bundled CLI.
# Safe by default — `ship` is a silent no-op unless the repo opted in with
# `autogit on` (config in .git/autogit.json).
#
# Fail-soft: no node on PATH → exit 0 silently (a machine without Node must
# never see hook errors). Real ship failures still surface (exit 1 + stderr).
command -v node >/dev/null 2>&1 || exit 0

# Double-wiring guard: if `autogit setup` also wired global hooks in
# ~/.claude/settings.json, those win — skip the plugin copy so a turn
# never ships twice.
grep -qs "autogit ship" "$HOME/.claude/settings.json" && exit 0

# Plugin hooks run in the session cwd, but be defensive like the global wiring.
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

# The plugin root is this script's parent dir — no env var needed.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/index.js" ship
