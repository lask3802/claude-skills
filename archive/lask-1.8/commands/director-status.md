---
description: Show whether lask director mode is on, and which switch decided it
allowed-tools: Bash
---

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/director-toggle.js" status`

Relay the state and its source to the user. If they want to change it, the switches are
`/lask:director-on`, `/lask:director-off`, `/lask:director-reset` (drop back to
`$LASK_DIRECTOR`), or `"env": {"LASK_DIRECTOR": "1"}` in a settings.json.
