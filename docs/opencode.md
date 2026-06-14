# autogit on OpenCode — status: reference implementation, not validated

OpenCode plugins are **JavaScript/TypeScript modules**, not skills or a JSON
manifest, so none of autogit's existing packaging (`skills/`, `commands/`,
`hooks/hooks.json`, the per-harness `plugin.json` files) applies. A port has to
be written as code. The autogit behavior maps cleanly onto OpenCode's event
bus, so a faithful port is tractable — but this repo ships it here as a
**reference implementation rather than a committed, active plugin**, because
there is no OpenCode CLI in the build/CI environment to validate it against, and
the public plugin docs are inconsistent about the exact event-handler signature
(a generic `event` hook receiving `{ event }` vs. hooks keyed directly by event
type such as `"session.idle"`). Shipping it as an asserted-working plugin would
overclaim. Test it against a live OpenCode install before relying on it.

## How it maps

| autogit lifecycle point | OpenCode event |
| --- | --- |
| ship after a turn finishes (Claude `Stop`) | `session.idle` |
| refresh the busy marker mid-turn (Claude `PostToolUse`) | `tool.execute.after` |

OpenCode plugins load from `.opencode/plugins/` (project-level) or
`~/.config/opencode/plugins/` (global). They receive a context object with
Bun's shell (`$`) and the working `directory`.

## Reference implementation

Save as `.opencode/plugins/autogit.js` in your project (or the global plugins
dir). It shells out to the `autogit` binary, so first make it available:

```bash
git clone https://github.com/mjenkinsx9/autogit && cd autogit && npm link
cd your-project && autogit on    # per-repo opt-in, same as every other harness
```

```javascript
// .opencode/plugins/autogit.js
// Requires `autogit` on PATH (npm link) and `autogit on` in the repo.
// UNVALIDATED against a live OpenCode runtime — see docs/opencode.md.
export const AutogitPlugin = async ({ $, directory }) => {
  const run = (args) => $`autogit ${args}`.cwd(directory).nothrow()

  return {
    // Ship once the session goes idle (turn finished).
    event: async ({ event }) => {
      if (event?.type === "session.idle") {
        await run(["ship"])
      }
    },
    // Keep the busy marker fresh so parallel agents take turns.
    "tool.execute.after": async () => {
      await run(["busy", "--id", "opencode"])
    },
  }
}
```

Notes / things to verify on a real install:

- The exact handler shape — if your OpenCode version doesn't deliver a generic
  `event` hook, replace it with a top-level `"session.idle": async () => { ... }`
  key.
- `autogit busy` needs a session id to attribute the marker; the static
  `--id opencode` above is a placeholder. Wire a real per-session id from the
  event payload so simultaneous OpenCode sessions in one repo don't share a
  marker (see the "Parallel agents" section in the README).
- `.cwd(directory)` ensures `ship` runs against the project repo, not wherever
  OpenCode launched from.

## References

- OpenCode plugins: https://opencode.ai/docs/plugins/
