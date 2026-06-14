---
description: CoalTipple routing stats — approximate token savings and delegate-down / escalate-up activity this session
---

Produce the CoalTipple stats report for this session, in the user's language. Tables only, minimal prose.

Drawn from the conversation context, show:
- **Routing activity:** counts of delegate-DOWN, escalate-UP, and route-OFF decisions this session, with the model + effort each used.
- **Approximate token savings:** an estimate only — there is no cost API, so label it clearly as approximate.

This is the `/coaltipple stats` action exposed as a discoverable command. Do not modify any file.
