# autogit on Gemini CLI — status: real port (skill), auto-ship is the remaining gap

Gemini CLI extensions now support **Agent Skills**, auto-discovered from a
`skills/<name>/SKILL.md` layout — exactly the layout autogit already uses for
its portable core (`skills/autogit-ops/SKILL.md`). So autogit ships a real
Gemini extension: a `gemini-extension.json` at the repo root, with the skill
reused (not duplicated), same as every other harness.

## What ships

`gemini-extension.json` (repo root), kept metadata-synced with
`.claude-plugin/plugin.json`:

```json
{
  "name": "autogit",
  "version": "0.6.0",
  "description": "Auto stage → secrets-scan → commit → push after every agent turn, …"
}
```

- `name` / `version` are the only required fields; `description` is shown on
  geminicli.com/extensions.
- There is **no `skills` field** — Gemini auto-discovers `skills/` from the
  extension root, so `skills/autogit-ops/SKILL.md` is exposed as the
  `autogit-ops` skill with no extra wiring.
- Gemini expects the extension `name` to match its directory name; when linked
  from this repo (directory `autogit`) that holds.

### Install (local / development)

```bash
git clone https://github.com/mjenkinsx9/autogit
gemini extensions link ./autogit     # loads from ~/.gemini/extensions
```

Then drive it from the agent the same way as elsewhere — invoke the
`autogit-ops` skill to run `on` / `off` / `status` / `undo` / `ship` against the
current repo (the skill resolves the bundled `index.js` from its own path).

## The remaining gap: automatic after-every-turn shipping

The Gemini extension delivers the **skill control surface**, not the
**automatic** stage→scan→commit→push after every turn. That automation is a
lifecycle hook, and it is the one piece that does not yet carry over:

- autogit's existing `hooks/hooks.json` is Claude-format (events `Stop` /
  `UserPromptSubmit` / `PostToolUse`, command interpolation via
  `${CLAUDE_PLUGIN_ROOT}`) and does not run under Gemini as-is.
- Gemini extensions can ship a `hooks/hooks.json`, but the public reference does
  not yet pin down the turn-completion event name, payload shape, or the
  environment a hook command receives — and there is no Gemini CLI in this
  repo's build/CI environment to verify a port against. Faking a hook config we
  can't test would be dishonest, so it's left out.

This mirrors the other non-Claude harnesses (Codex, Cursor, Factory): the
plugin/extension adds the `/autogit` control surface, and automatic shipping is
expected to come from `autogit setup` once Gemini is added to its wiring (see
the Roadmap in the README) or from a Gemini-native turn-end hook once that
event is documented and testable.

Until then, the harness-agnostic path also works:

```bash
git clone https://github.com/mjenkinsx9/autogit && cd autogit && npm link
autogit setup && cd your-project && autogit on
```

## References

- Gemini CLI extensions reference: https://geminicli.com/docs/extensions/reference/
- Gemini CLI skills: https://geminicli.com/docs/cli/skills
