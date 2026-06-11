#!/usr/bin/env bash
# Claude Code UserPromptSubmit + PostToolUse hook (plugin wiring): mark this
# repo busy and stash the turn's prompt for the commit subject. Must stay
# silent on stdout (UserPromptSubmit stdout is injected into model context).
command -v node >/dev/null 2>&1 || exit 0

# Double-wiring guard — mirror of ship.sh (see there).
grep -qs "autogit busy" "$HOME/.claude/settings.json" && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/index.js" busy
