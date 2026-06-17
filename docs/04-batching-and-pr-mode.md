# Batching & PR Mode

## Batching

By default every turn ships. Set `quiet` in the config to batch instead:

```json
{ "mode": "auto", "quiet": "5m" }
```

Turns accumulate, and autogit ships once the repo has been quiet — no agent turn ended — for that long. One commit: the subject is the last prompt, the body lists all of them. Values are seconds, or strings like `"90s"` / `"5m"`.

`autogit ship --flush` ships any pending batch (plus uncommitted changes) right now, skipping the wait. `autogit status` shows pending batches.

No daemon: each turn spawns a short-lived detached timer, and if a timer ever dies the next ship notices the aged batch and flushes it as a backstop.

## PR mode

Set `pr: true` and autogit pushes to `autogit/<branch>` instead of `<branch>`. If `gh` is installed, it auto-opens a pull request (and leaves an already-open one alone on later ships); without `gh` the push still lands, with a note. `autogit undo` rewinds the PR branch. Your local branch still carries the commits — the PR branch is just where they're pushed. (Undo reads the config to know which branch to rewind, so undo a PR-mode ship *before* running `autogit off`.)

PR mode and `quiet` compose freely.

---

Back to the documentation index: [README.md](README.md)
