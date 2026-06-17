# Safety

- **Opt-in per repo** — repos without `autogit on` are never touched. Config lives in the git dir (`.git/autogit.json`), never committed — enabling autogit can't silently opt in your teammates. (A legacy root `.autogit.json` is still honored; `autogit on` migrates it.)
- **No silent losses** — a failed push leaves a marker and is retried on later turns (`status` shows it); a failed or blinded secrets scan blocks instead of passing; a failed `git add` is a visible error, not "nothing changed".
- **One-command undo** — `autogit undo` takes back the last auto-push, remote included.
- **Merge/rebase guard** — mid-merge, mid-rebase, mid-cherry-pick, or mid-bisect repos are never shipped.
- **Secrets scan** — blocks pushes containing Anthropic, OpenAI, AWS, GitHub (classic + fine-grained), GitLab, Stripe, npm, SendGrid, Twilio, Slack, or Google keys, private key blocks, JWTs, and sensitive files (`.npmrc`, `.pypirc`, `.env*`, key files) — and unstages everything. Override with `--force-secrets`. Commit messages are covered too: a prompt containing a secret never becomes the subject (not overridable). It's a pattern-based screen, not a guarantee — for high-stakes repos, run a dedicated scanner as well.
- **No noise** — nothing changed means nothing shipped. Aborted or errored Cursor turns never ship.
- **Parallel-agent aware** — if another agent is still mid-task in the same repo, autogit waits its turn: the last agent to finish ships everything. (For fully separate commits per agent, use worktrees — autogit handles each independently.)

---

Back to the documentation index: [README.md](README.md)
