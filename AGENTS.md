# AGENTS.md

Everything about the project — what it is, architecture, internals, roadmap — lives in [README.md](README.md). Read it first. This file only covers how agents should work and respond here.

## Response style

- Make your answers clear and very concise.
- Use simple, easy-to-understand language. Short sentences.
- Lead with the answer. Skip preamble, filler, and repetition.
- No options or caveats the owner didn't ask for.

## Working rules

- **NEVER publish to npm yourself** — no `npm publish`, ever. When a release is ready, ask Mike (the human owner) to publish: give clear & concise instructions plus the exact terminal command in a code block. (The package also needs a rename first — `@davidondrej/autogit` is the upstream author's scope.)
- Keep it minimal: small files, zero dependencies, simplest thing that works.
- Treat the implementation as a reference of product intent, not fixed architecture.
- Confirm any major structural change with the owner before implementing.
- Roadmap items are owner-gated: don't build them without a go-ahead.
- When behavior or architecture changes, update README.md.
