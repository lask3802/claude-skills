---
description: Read the final response from a completed Codex job
argument-hint: "[job-id]"
allowed-tools: Bash
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-job.mjs" result "$ARGUMENTS"`

Relay the result above faithfully. If no job ID was supplied, the newest job in
the current workspace was selected. Do not describe a failed or cancelled job
as completed.
