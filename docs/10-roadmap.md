# Roadmap

Owner-gated — don't build these without a go-ahead.

- **agent mode** — an LLM reviews the diff before push, for more serious repos. Owner decision 2026-06-09 (upstream): the *currently-running* agent should review (it has task context), not a separate OpenRouter call. Mechanics TBD.
- **human mode** — terminal y/n prompt on the diff, for production repos. (Existed in the pre-MVP prototype, cut for focus.)
- More agents in `setup` (Pi added 2026-06-10; Hermes next: `post_llm_call` shell hook in `~/.hermes/config.yaml` + reading `cwd` from stdin JSON in `ship` + user consent flow).
- Richer PR flows — basic PR mode shipped in 0.5.0 (push to `autogit/<branch>` + auto-open via `gh`); deeper PR integration considered.

---

Back to the documentation index: [README.md](README.md)
