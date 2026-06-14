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

## The remaining gap: automatic after-every-turn shipping is *blocked*, not just unported

The Gemini extension delivers the **skill control surface**, not the
**automatic** stage→scan→commit→push after every turn. Unlike Codex/Cursor/
Factory — which this plugin *does* wire with native hooks — Gemini's auto-ship
is blocked by a hard, structural conflict with Claude Code. Here is the exact
reasoning, because it is not obvious:

1. **Gemini's hook events are known.** Gemini fires `BeforeAgent` (prompt
   submitted), `AfterAgent` (once per turn after the final response), and
   `AfterTool`. So a Gemini-native auto-ship hook is straightforward to write —
   `AfterAgent` → ship, `BeforeAgent`/`AfterTool` → busy marker.
2. **But Gemini only reads hooks from the root `hooks/hooks.json`.** There is no
   manifest field to point it elsewhere (`gemini-extension.json` does not
   declare hooks; they are auto-discovered).
3. **Claude Code also hard-reads that same root `hooks/hooks.json`** — and its
   loader/validator *rejects* unknown event keys. `claude plugin validate .`
   fails with `hooks.AfterAgent: Invalid key in record` the moment Gemini's
   events are added to the shared file. Pointing Claude's manifest at a
   different hook file does **not** help: Claude still validates and loads the
   root file.
4. **So the two cannot coexist.** Claude needs the root file to contain only its
   own event names; Gemini needs the root file to contain its (different) event
   names; neither can read from anywhere else. One repo can't satisfy both.

Rather than break Claude Code (the primary, runtime-validated harness) or fake
an untested Gemini hook in the active root file, autogit ships Gemini's **skill**
in-place and provides the Gemini auto-ship hooks as a **ready-to-use template**
that a Gemini-only install copies into position.

### Gemini-only install: enable auto-ship

The template lives at [`hooks/gemini.json`](../hooks/gemini.json) (it is inert
where it sits — Gemini only auto-discovers `hooks/hooks.json`, and Claude never
validates a non-`hooks.json` file). For an autogit checkout used **only** with
Gemini (no Claude Code plugin reading this root), activate it:

```bash
gemini extensions link ./autogit         # exposes the autogit-ops skill
cp ./autogit/hooks/gemini.json ./autogit/hooks/hooks.json   # Gemini-only: enable auto-ship
cd your-project && gemini ... # then drive `autogit on` via the autogit-ops skill
```

`hooks/gemini.json` uses Gemini's events (`AfterAgent` → ship, `BeforeAgent` /
`AfterTool` → busy marker) and `${extensionPath}`; the shared `ship.sh`/`busy.sh`
re-derive the real plugin root from their own path. Do **not** do this in a
checkout that is also installed as the Claude Code plugin — that is exactly the
collision described above (`claude plugin validate` would then fail).

The harness-agnostic path also works without touching hook files:

```bash
git clone https://github.com/mjenkinsx9/autogit && cd autogit && npm link
autogit setup && cd your-project && autogit on
```

## References

- Gemini CLI extensions reference: https://geminicli.com/docs/extensions/reference/
- Gemini CLI skills: https://geminicli.com/docs/cli/skills
