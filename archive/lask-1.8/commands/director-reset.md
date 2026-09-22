---
description: Clear the lask director on/off flag files and fall back to $LASK_DIRECTOR
allowed-tools: Bash
---

!`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/director-toggle.js" reset`

Report the resulting state: the explicit flag files are gone, so the verdict now comes
from `$LASK_DIRECTOR` (settings.json `env`) or, absent that, the opt-in default of OFF.
