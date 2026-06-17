# Commands

```
autogit setup     Wire up agent hooks (once per machine)
autogit teardown  Remove all global agent hooks (per-repo configs untouched)
autogit on        Enable auto-push in this repo
autogit off       Disable auto-push in this repo
autogit ship      Stage, scan, commit, push (what the hooks run)
autogit undo      Take back the last autogit commit, local + remote
autogit status    Show hooks + repo state (including pending batches)
autogit --version Print the installed version (-v)
```

**`ship` flags**: `-m "message"` sets the commit subject. `--force-secrets` pushes past a diff-scan block. `--dry-run` runs the whole pipeline — stages, scans, computes the subject and push target — then reports what would happen and unstages everything. Note: dry-run (like `ship` itself) runs `git add -A` + `git reset`, so it clears any manual staging selection. `--flush` ships a pending batch immediately (see [Batching](04-batching-and-pr-mode.md)).

**Commit messages**: `autogit ship -m "message"` uses your message. Without `-m`, the subject is the prompt you gave your agent that turn (so `git log` reads like your instructions), falling back to a list of changed files. Two filters apply: a prompt that looks like it contains a secret (pasted API key, token, etc.) is never used — not overridable — and a prompt that wouldn't make a useful subject (short "yes"/"ok"-type replies, slash commands) is skipped for the next candidate, ultimately the file list.

**Undo**: shipped something you regret? `autogit undo` rewinds the remote branch, removes the commit locally, and leaves the changes uncommitted in your working tree — ready to fix and re-ship. Run it again to peel off earlier autogit commits. It refuses to touch commits it didn't make, or remotes that have since moved on.

---

Back to the documentation index: [README.md](README.md)
