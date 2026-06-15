# CoalTipple Privacy Policy

**CoalTipple collects nothing and phones nowhere.**

- **No telemetry.** No usage data, analytics, or identifiers are collected, stored, or transmitted — by the skill, the conductor hook, the installer, or any bundled component.
- **No network calls from the hook.** The conductor hook is offline by design (Phoenix Commandment #7): it reads `.coaltipple.json` and the prompt locally and emits an advisory routing hint. It opens no sockets and makes no requests.
- **Routing runs inside YOUR agent.** CoalTipple itself operates no servers and receives no traffic. When it routes, it spawns a worker through your agent's *own* native subagent tool, on your account, under your platform's own permission gate — CoalTipple does not call any model API itself and does not bypass that gate.
- **The `/coaltipple stats` figure is a local estimate.** There is no cost API behind it; nothing is reported anywhere.
- **Error reports are manual.** When a component misbehaves, your agent may *offer* to open a pre-filled GitHub issue; nothing is ever submitted automatically, and you see and edit the full contents before sending.
- **Local files only.** All state lives in files you can read: the config (`~/.claude/.coaltipple.json` and an optional per-project `.coaltipple.json`) and the project-scoped `.coaltipple/` directory (the model ranking, the `proposed/` sandbox, and the `state.json` resume journal).

Questions: open an issue at <https://github.com/TheColliery/CoalTipple/issues>.
