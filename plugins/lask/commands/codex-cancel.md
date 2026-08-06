---
description: Request safe cancellation of a running Codex job
argument-hint: "[job-id]"
allowed-tools: Bash
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-job.mjs" cancel "$ARGUMENTS"`

Relay the cancellation state above. If no job ID was supplied, the newest job
in the current workspace was selected. A `cancelling` response means the request
was recorded but the runner has not acknowledged termination yet.
