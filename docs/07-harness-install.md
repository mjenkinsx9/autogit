# Install as a Plugin Across Harnesses

The Agent Skill at `skills/autogit-ops/SKILL.md` is autogit's portable core — it tells any agent how to find and drive the bundled `index.js`. To make the same repo installable as a native plugin in several agent harnesses, autogit ships one tiny manifest per harness, all pointing at the **same** `skills/` (and, where supported, `commands/` and `hooks/`) — no duplicated content. Metadata (`name`/`version`/`description`) is kept in sync across all of them and checked by `test/plugin.test.js`.

Two surfaces matter per harness: the **control surface** (the `autogit-ops` skill, invokable by the agent everywhere; plus the `/autogit` slash command where the harness packages `commands/`) and **auto-ship** (lifecycle hooks that run stage→scan→commit→push after every turn).

| Harness | Control surface | Native auto-ship hooks | Validated here? |
| --- | --- | --- | --- |
| **Claude Code** | skill + `/autogit` | ✅ `hooks/hooks.json` (`Stop`/`UserPromptSubmit`/`PostToolUse`) | ✅ `claude plugin validate .` + test suite |
| **OpenAI Codex** | skill | ✅ `hooks/codex.json` (same events; `${PLUGIN_ROOT}`) | ⚠️ schema-conformant, no Codex CLI to run |
| **Factory Droid** | skill + `/autogit` | ✅ shares `hooks/hooks.json` (`${DROID_PLUGIN_ROOT}`) | ⚠️ schema-conformant, no Droid CLI to run |
| **Cursor** | skill + `/autogit` | ✅ `hooks/cursor.json` (`stop`/`beforeSubmitPrompt`/`postToolUse`) | ⚠️ schema-conformant, no Cursor CLI to run |
| **GitHub Copilot CLI** | skill + `/autogit` | — (uses `autogit setup`) | ⚠️ via `.claude-plugin` fallback |
| **Gemini CLI** | skill | ⚠️ template only (`hooks/gemini.json`, see below) | ⚠️ skill auto-discovered |
| **OpenCode** | reference plugin | reference plugin | 📄 unvalidated, see docs |

How each manifest reaches its hooks:

- **Claude Code** auto-discovers `hooks/hooks.json`. **Factory Droid** also auto-discovers that same file — both use the `Stop`/`UserPromptSubmit`/`PostToolUse` event names, and the command resolves from whichever plugin-root variable the running harness sets (`${CLAUDE_PLUGIN_ROOT}` / `${DROID_PLUGIN_ROOT}`).
- **Codex** and **Cursor** point their manifest `hooks` field at a dedicated file (`hooks/codex.json`, `hooks/cursor.json`) — Codex because it reuses Claude's event schema (and offers `${CLAUDE_PLUGIN_ROOT}` for compat), Cursor because its schema differs (lowercase events, flat entries, no plugin-root variable → relative paths).
- The shared `ship.sh`/`busy.sh` take a harness argument so their double-wiring guard checks the right global config (`~/.claude` / `~/.codex` / `~/.cursor`), and they re-derive the real plugin root from their own path — so they work no matter which variable located them.

Caveats (honest):

- **Only Claude Code is runtime-validated.** No Codex/Droid/Cursor/Gemini/Copilot CLI exists in this repo's build environment, so their hook files are schema-conformant against each harness's current docs but **not executed end-to-end**. Treat non-Claude auto-ship as best-effort until tested on a live install.
- **Codex needs a one-time hook trust.** Codex treats plugin-bundled hooks as non-managed and skips them until you review and trust the current definition with `/hooks` inside Codex (its trust is hash-based, so it re-prompts whenever the hook file changes). So after installing `.codex-plugin/plugin.json` and running `on`, run `/hooks` and trust autogit's hooks once — until then Codex shows no automatic commits. (Same approval the [`autogit setup`](02-installation.md#supported-agents) path documents.)
- **Gemini auto-ship can't be active alongside Claude's.** Gemini extensions only read hooks from the root `hooks/hooks.json`, but Gemini uses different event names (`AfterAgent`/`BeforeAgent`/`AfterTool`) and **Claude's loader rejects those keys in that shared file** (`claude plugin validate` fails on them). Since Claude and Gemini both hard-read the same root file with mutually incompatible schemas, their hooks can't coexist in one repo. So the Gemini hooks ship as a ready-to-use **template** at [`hooks/gemini.json`](../hooks/gemini.json) (inert where it sits): a Gemini-**only** install copies it to `hooks/hooks.json` to enable auto-ship. Full steps and reasoning in [gemini.md](gemini.md).
- **Control surface varies.** Every harness exposes the `autogit-ops` **skill** (the agent invokes it). The `/autogit` **slash command** also appears where the harness packages `commands/` (Claude, Cursor, Copilot, Factory). Codex exposes skills only, and Gemini's custom commands are TOML — on those two, drive autogit through the skill, not a `/autogit` command.
- **Copilot CLI** reads `.claude-plugin/plugin.json` as one of its documented manifest locations (it checks `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`, then `.claude-plugin/plugin.json`), so no extra file is needed; auto-ship there comes from `autogit setup`.
- **Codex marketplace listing:** a Codex catalog lists plugins from `.agents/plugins/marketplace.json` with `source.path` entries — that file lives in the **catalog** repo, not here.
- **OpenCode** is a JS event module (no skills, no manifest); a faithful port needs runtime-tested work that couldn't be validated here. [opencode.md](opencode.md) has a copy-pasteable reference plugin.

---

Back to the documentation index: [README.md](README.md)
