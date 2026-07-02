# Claude Code Hook/Plugin Capability Notes (research for director-mode v2)

Date: 2026-07-02. Researched from official docs (base `https://code.claude.com/docs/en/`:
`hooks`, `plugins-reference`, `sub-agents`, `skills`). plugins-reference / sub-agents /
skills were read near-verbatim; the hooks page came via a fetch summarizer (three
cross-consistent passes) — summarizer-only claims are flagged.

These notes exist to ground the v2 enforcement layer promised in
`2026-07-02-director-mode-design.md` ("Out of scope / v2"). v1 does not depend on them.

## 1. Subagent vs main-session detection in hooks (v2's key enabler)

- PreToolUse hooks DO fire for subagents' tool calls (subagents run their own loop).
- **`agent_id` is present in hook stdin ONLY inside a subagent call** — the clean
  discriminator. Absent = main session.
- `agent_type` alone is NOT sufficient: it also appears in the main session under
  `claude --agent <name>`. For plugin subagents it is the scoped id (`lask:scout`).
- Secondary signal: subagent `transcript_path` is
  `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`.
- Do NOT exist: `parent_tool_use_id` field; `CLAUDE_AGENT_TYPE` env var.

**v2 sketch:** PreToolUse on `^(Edit|Write|NotebookEdit)$`: if `agent_id` absent
(main session) → count/threshold, then `additionalContext` nudge (allow) or deny with
reason; if present → exit 0.

## 2. Plugin `agents/` directory

- `agents/` at plugin root, recursive; subfolder deepens the scoped id
  (`agents/review/security.md` → `my-plugin:review:security`).
- Frontmatter: `name`, `description`, `model`, `effort`, `maxTurns`, `tools`,
  `disallowedTools`, `skills`, `memory`, `background`, `isolation` (`"worktree"` only).
- IGNORED for plugin agents (security): `hooks`, `mcpServers`, `permissionMode`.
- `model`: `sonnet` | `opus` | `haiku` | `fable` | full model ID | `inherit` (default).
- `tools` allowlist; `disallowedTools` denylist (deny applied first).

## 3. Commands/skills frontmatter

- Custom commands merged into skills; `commands/*.md` and `SKILL.md` share frontmatter:
  `name`, `description`, `when_to_use`, `argument-hint`, `arguments`,
  `disable-model-invocation`, `user-invocable`, `allowed-tools`, `disallowed-tools`,
  `model`, `effort`, `context` (`fork`), `agent`, `hooks`, `paths`, `shell`.
- `disable-model-invocation: true` = manual-only skill (also not preloaded into
  subagents). `user-invocable: false` = model-only.
- Dynamic context injection: inline `` !`cmd` `` / fenced ```` ```! ```` blocks run at
  load time (preprocessing); `$ARGUMENTS`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_SKILL_DIR}`,
  `${CLAUDE_PROJECT_DIR}` substitutions. Disabled by `disableSkillShellExecution`.

## 4. SessionStart + subagent lifecycle events

- SessionStart stdin: `session_id`, `transcript_path`, `cwd`, `hook_event_name`,
  `source` (`startup|resume|clear|compact`), optional `model` (can be omitted — check),
  optional `agent_type`, optional `session_title`. NO `permission_mode`.
- SessionStart does NOT fire for subagents (flagged: summarizer-only). Subagents get
  **`SubagentStart`** / **`SubagentStop`** events (matcher = agent type name; input =
  common fields + `agent_id` + `agent_type`). Colon in a matcher makes it an unanchored
  regex — anchor plugin-scoped names (`^lask:scout$`).
- v2 option: SubagentStart matched on `^lask:` could inject per-role reinforcement.

## 5. UserPromptSubmit context injection

- `hookSpecificOutput.additionalContext` (structured) or plain stdout on exit 0 (one of
  the stdout-visible exceptions: UserPromptSubmit, UserPromptExpansion, SessionStart,
  Setup, SubagentStart).

## 6. PreToolUse output semantics

- `hookSpecificOutput`: `permissionDecision` (`allow`/`deny`/`ask`; `defer` flagged
  unverified), `permissionDecisionReason`, `updatedInput` (v2.0.10+),
  **`additionalContext` — model-facing, combinable with allow** (non-blocking nudge).
- Top-level: `continue:false` hard-stops Claude (+ user-facing `stopReason`);
  `systemMessage` is USER-facing only (not a model channel); `suppressOutput` hides
  stdout from transcript.

## Unverified / gaps

1. `stop_hook_active` for SubagentStop — unverified.
2. `defer` permission value — summarizer-only.
3. "SessionStart not fired for subagents" — consistent but not verbatim-quoted.
4. For byte-exact schemas, fetch `https://code.claude.com/docs/llms.txt` or read in a
   browser (hooks page resists raw fetch).
