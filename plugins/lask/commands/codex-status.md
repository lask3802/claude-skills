---
description: Show progress for a Codex job in the current workspace
argument-hint: "[job-id|--all]"
allowed-tools: Bash
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-job.mjs" status "$ARGUMENTS"`

Relay the status above. Explain that `queued` / `running` / `unresponsive` are
non-terminal; `completed` / `failed` / `cancelled` / `stale` are terminal. If no
job ID was supplied, the newest job in the current workspace was selected.
