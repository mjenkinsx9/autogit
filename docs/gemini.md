# autogit on Gemini CLI — status: not ported (documented gap)

Gemini CLI uses a different extension model from the skills/commands/hooks
plugins that Claude Code, Codex, Copilot CLI, Cursor, and Factory Droid share,
so autogit does **not** currently ship a Gemini extension. This file explains
what a faithful port would require so nobody assumes the gap is an oversight.

## Why the other manifests don't carry over

A Gemini extension is declared by a `gemini-extension.json` at the extension
root. Its first-class surface is **MCP servers** (`mcpServers`), plus
context files (`contextFileName`), tool exclusions (`excludeTools`),
user settings, themes, and TOML custom commands under `commands/`. There is
**no skills primitive** equivalent to a `SKILL.md`, so autogit's portable core
— `skills/autogit-ops/SKILL.md` — has nothing to point at.

Required `gemini-extension.json` fields (to keep in sync with
`.claude-plugin/plugin.json` if/when this is built):

- `name` — lowercase, digits and dashes only (Gemini expects it to match the
  extension directory name): `autogit`
- `version` — `0.6.0`
- `description` — the autogit one-liner

## What a real port would take

autogit's value is a **lifecycle hook**: after every agent turn in an opted-in
repo, run `stage → secrets-scan → commit → push`. Two routes exist on Gemini,
and neither is a drop-in:

1. **Hooks (`hooks/hooks.json`).** Gemini extensions can ship a
   `hooks/hooks.json`, but as of this writing the public extension reference
   does not pin down the turn-end event name, the payload shape, or the
   environment variables a hook command receives. autogit's existing
   `hooks/hooks.json` is Claude-format (events `Stop` /
   `UserPromptSubmit` / `PostToolUse`, command interpolation via
   `${CLAUDE_PLUGIN_ROOT}`) and would not run under Gemini as-is. A port
   needs Gemini's real event names and a wrapper that resolves the autogit
   `index.js` path the way `hooks/ship.sh` does for Claude — work that can't be
   verified without a Gemini CLI to test against.

2. **MCP server.** autogit could expose `on` / `off` / `status` / `ship` /
   `undo` as MCP tools so the model can drive them on request. That restores
   the **manual** control surface (what `/autogit` gives you elsewhere) but
   **not** the automatic after-every-turn shipping, which is the whole point —
   MCP tools are model-invoked, not lifecycle-triggered.

A genuine port is therefore route 1, gated on Gemini documenting (and this repo
testing) a turn-completion hook. Until then, Gemini users can still use autogit
the harness-agnostic way:

```bash
git clone https://github.com/mjenkinsx9/autogit && cd autogit && npm link
autogit setup     # wires the agents autogit already supports
cd your-project && autogit on
```

`autogit setup` does not yet wire Gemini (see the Roadmap in the README); doing
so is the same hook work described above.

## References

- Gemini CLI extensions reference: https://geminicli.com/docs/extensions/reference/
