#!/usr/bin/env bash
# Plugin busy hook (multi-harness): mark this repo busy and stash the turn's
# prompt for the commit subject. Wired to each harness's prompt-submit and
# post-tool-use events. Must stay silent on stdout (some harnesses inject hook
# stdout into model context). $1 names the harness (see ship.sh).
command -v node >/dev/null 2>&1 || exit 0

# Double-wiring guard — mirror of ship.sh (see there). Factory shares the root
# hooks.json with Claude (arg `claude`); disambiguate by its own env var.
harness="${1:-claude}"
[ -n "$DROID_PLUGIN_ROOT" ] && harness="factory"
case "$harness" in
  claude) guard="$HOME/.claude/settings.json" ;;
  codex)  guard="$HOME/.codex/hooks.json" ;;
  cursor) guard="$HOME/.cursor/hooks.json" ;;
  *)      guard="" ;;
esac
[ -n "$guard" ] && grep -qs "autogit busy" "$guard" && exit 0

# Honor the harness's project-root var (Claude/Factory) — see ship.sh.
cd "${CLAUDE_PROJECT_DIR:-${FACTORY_PROJECT_DIR:-.}}" 2>/dev/null || exit 0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/index.js" busy
