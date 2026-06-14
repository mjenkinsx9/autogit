#!/usr/bin/env bash
# Plugin ship hook (multi-harness): ship the turn via the bundled CLI.
# Wired by every harness's plugin manifest — Claude/Codex/Factory/Gemini via a
# hooks.json that resolves this script's path from a harness-specific variable
# (${CLAUDE_PLUGIN_ROOT}/${PLUGIN_ROOT}/${DROID_PLUGIN_ROOT}/${extensionPath}),
# Cursor via a relative path. $1 names the harness so the double-wiring guard
# checks the right global config. Defaults to claude for back-compat.
#
# Safe by default — `ship` is a silent no-op unless the repo opted in with
# `autogit on` (config in .git/autogit.json).
#
# Fail-soft: no node on PATH → exit 0 silently (a machine without Node must
# never see hook errors). Real ship failures still surface (exit 1 + stderr).
command -v node >/dev/null 2>&1 || exit 0

# Double-wiring guard: if `autogit setup` also wired this agent globally, that
# wiring wins — skip the plugin copy so a turn never ships twice. Only the
# harness named in $1 has a global config to clash with (setup wires
# Claude/Codex/Cursor); Factory/Gemini have none, so nothing to guard.
#
# The root hooks.json is shared by Claude and Factory and always passes
# `claude`; disambiguate by Factory's own env var so a Factory turn never
# stands down just because a Claude global hook exists on the same machine.
harness="${1:-claude}"
[ -n "$DROID_PLUGIN_ROOT" ] && harness="factory"
case "$harness" in
  claude) guard="$HOME/.claude/settings.json" ;;
  codex)  guard="$HOME/.codex/hooks.json" ;;
  cursor) guard="$HOME/.cursor/hooks.json" ;;
  *)      guard="" ;;
esac
[ -n "$guard" ] && grep -qs "autogit ship" "$guard" && exit 0

# Plugin hooks usually run in the session cwd, but some harnesses run them from
# elsewhere and expose the project root in an env var (Claude: CLAUDE_PROJECT_DIR,
# Factory: FACTORY_PROJECT_DIR — its docs warn the hook cwd may differ). Cursor
# carries workspace_roots in the stdin payload, which `ship` reads itself.
cd "${CLAUDE_PROJECT_DIR:-${FACTORY_PROJECT_DIR:-.}}" 2>/dev/null || exit 0

# The plugin root is this script's parent dir — resolved from its own path, so
# it works no matter which harness variable located the script (or none).
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/index.js" ship
