---
description: Set up or change CoalTipple's memory anchor (on | off | set <file>) — the context a fresh worker reads
---

Manage CoalTipple's **memory anchor** — the project file a freshly-spawned worker reads for conventions and context beyond the bare task contract. Argument:

- `on` — offer to create a memory file, choose an existing one, or skip.
- `off` — disable the anchor and persist the choice (never re-ask).
- `set <file>` — use the named file as the anchor.

Follow the **Memory anchor** procedure in the CoalTipple skill (`SKILL.md`); load and append to an existing anchor, never clobber it. Respond in the user's language. This is the `/coaltipple memory` action exposed as a discoverable command.
