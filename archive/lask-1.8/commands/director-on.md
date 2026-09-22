---
description: Turn lask director mode ON (delegation policy + hands-on edit throttle)
allowed-tools: Bash
---

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/director-toggle.js" on`

Report the command output above to the user in one or two lines: director mode is now
ON, and the policy text is injected at SessionStart so it lands on the next session or
after `/clear` (the hands-on edit throttle is already active).
