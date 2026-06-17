# Configuration

`autogit on` writes `autogit.json` into the git common dir — `.git/autogit.json` in a normal clone, shared by all linked worktrees. All keys, with defaults:

```json
{
  "mode": "auto",
  "remote": "origin",
  "branch": "current",
  "secretsScan": true,
  "quiet": 0,
  "pr": false
}
```

- `mode` — currently always `auto` (ship immediately, no review gate). Review modes are on the [roadmap](10-roadmap.md).
- `remote` — the remote to push to (default `origin`).
- `branch` — `current` pushes the checked-out branch; or name a fixed branch.
- `secretsScan` — the staged-diff secrets gate (see [Safety](06-safety.md)).
- `quiet` — quiet-batching window in seconds, or a string like `"5m"` (see [Batching](04-batching-and-pr-mode.md)).
- `pr` — push to `autogit/<branch>` and auto-open a PR (see [PR mode](04-batching-and-pr-mode.md)).

---

Back to the documentation index: [README.md](README.md)
