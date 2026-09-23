---
description: Audit this Claude Code setup against the Opus 5.5 playbook checklist; --install adds the managed stop rule to CLAUDE.md and selects the lask:TW Hybrid output style when none is set
argument-hint: "[--install] [--force] [--json]"
allowed-tools: Bash
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" $ARGUMENTS`

Relay the report above: FAIL and WARN lines first, each with its fix, then one line for
the PASS count. Do not re-run the doctor or edit any file unless the user asks. If the
report shows `think-lines` or `reasoning-requests` hits, offer to remove those lines; the
user decides.
