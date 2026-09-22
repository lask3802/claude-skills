---
description: Turn lask director mode OFF (keeps skills, agents and model tiering)
allowed-tools: Bash
---

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/director-toggle.js" off`

Report the command output above to the user in one or two lines: director mode is now
OFF — no delegation policy injected and no hands-on edit throttle — while the skills,
the agent roster and the model-tiering hooks stay available. Policy text already in the
current session's context stays until `/clear`.
