---
name: codex-run
description: Use ONLY when the user or director explicitly dispatches a task to the Codex CLI and names it — 「用 codex 跑」「dispatch to codex」「/lask:codex-run」— optionally specifying a model (sol/terra/luna) and reasoning effort. Runs exactly ONE codex exec session from the verified model×effort table, collects the result, and relays it faithfully. Mechanical by design — a sonnet or haiku executor can follow it verbatim. Not for deciding WHETHER to use Codex — that call belongs to the user/director.
---

# codex-run — 手動派發一個任務給 Codex CLI

One dispatched task → one `codex exec` session → result relayed back, verbatim.
Zero judgment required: every choice is a row in a table. If the dispatch didn't
specify something, use the marked default — do not invent.

## Verified model × effort table

Probed live on 2026-07-13 (Codex CLI 0.144.0, 18/18 cells, "Reply OK" probes;
internal IDs resolved to `gpt-5.6-{sol,terra,luna}-1p-codexswic-ev3`):

| `-m` model | `none` | `minimal` | `low` | `medium` | `high` | `xhigh` |
|---|---|---|---|---|---|---|
| `gpt-5.6-sol` | ✅ | ❌ 400 | ✅ | ✅ | ✅ (預設↓) | ✅ |
| `gpt-5.6-terra` | ✅ | ❌ 400 | ✅ | ✅ | ✅ | ✅ |
| `gpt-5.6-luna` | ✅ | ❌ 400 | ✅ | ✅ | ✅ | ✅ |

- `minimal` is rejected by ALL three models (`400 unsupported_value`) even though
  the param enum accepts it — never use it.
- The menu is plan-dependent and changes over time. On a fresh
  `400 unsupported_value` / "model not supported", report the exact error —
  do NOT try other cells to "fix" it yourself.
- **Quality evidence exists only for `gpt-5.6-sol`** (benchmark-validated,
  2026-07). `terra`/`luna` are verified *callable*, nothing more — use them only
  when the dispatch names them explicitly.

**Defaults when the dispatch doesn't specify:** model `gpt-5.6-sol`;
effort `xhigh` for implementation, `high` for review/analysis,
`low` for trivial mechanical edits. Sandbox: `workspace-write` when Codex must
write files, `read-only` for review/analysis/second-opinion.

## Procedure (follow in order)

1. **Write the prompt to a file.** Include the dispatch verbatim (goal, scope,
   constraints, acceptance criteria) plus: "Implement exactly to scope, match
   surrounding code style, self-test, and summarize every file changed."
   NEVER pass the prompt as a shell argument — quotes/backticks/`$()` corrupt
   it. Stdin only.

2. **Run** (fill `<model>`, `<effort>`, `<sandbox>`, `<workspace>` from the
   dispatch + table):

   ```bash
   codex exec -m <model> -c model_reasoning_effort="<effort>" \
     --sandbox <workspace-write|read-only> \
     --skip-git-repo-check --color never --cd "<workspace>" \
     --output-last-message "<tmp>/codex-run-last.md" - < "<tmp>/codex-run-prompt.md"
   ```

   - Effort `high`/`xhigh` on a real task can run 20–60+ minutes: run it in the
     BACKGROUND (Bash `run_in_background: true`) and wait for completion. Never
     give it a default 2-minute timeout — that kills it mid-flight.
   - Never add `--dangerously-bypass-approvals-and-sandbox` or any
     `--dangerously-*` flag. `workspace-write` is the maximum elevation.

3. **Collect the result:**
   - Read `<tmp>/codex-run-last.md` — this is Codex's own final message.
   - Write mode: run `git status` + `git diff --stat` in the workspace and list
     what actually changed. If nothing changed but the message claims success,
     say exactly that.
   - Codex's sandbox has NO network and NO browser. If the deliverable renders
     in a browser, Codex could not have verified it visually — say so in the
     report, and if you have Bash access, open it headless
     (`chrome --headless=new --screenshot=...`) at desktop + ~390px widths and
     report what you see.

4. **Relay to the user/director** — four fixed sections, no editorializing:
   - **Codex 回報**：the last-message content, verbatim or tightly condensed —
     never "improved".
   - **實際變更**：`git diff --stat` output (write mode) or "read-only run".
   - **執行參數**：model / effort / sandbox / wall time.
   - **異常**：anything from the failure table below, or "無".

## Failure table

| Symptom | Action |
|---|---|
| `turn.failed`: "Selected model is at capacity" | Server-side, TRANSIENT — can hit after substantial work. ONE retry with identical flags; report the lost attempt. |
| `400 unsupported_value` on `reasoning.effort` | You picked a ❌ cell (or the menu changed). Use the dispatched/default ✅ cell; if the dispatch itself named the bad cell, report back instead of guessing. |
| `400` "model not supported" | Plan-gating. Report verbatim and STOP. NEVER silently substitute another model — that is a user/director decision. |
| Timeout/crash/truncated output | ONE retry with identical flags, then report honestly. |
| stderr: `rmcp::transport ... http://127.0.0.1:8080/mcp` errors | Known noise from a dead local MCP server entry — harmless, Codex proceeds. Ignore; do not report as a failure. |
| Codex missing / unauthenticated | Report and STOP. Do not implement the task yourself. |

## Quota (only when asked, or after an unusually large run)

Rate limits ride on rollout files, not the CLI: latest non-null
`payload.rate_limits` on a `token_count` event under
`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (`primary`=5h window,
`secondary`=weekly; warn when `100 - used_percent < 20`). The self-contained
reader script lives in `agents/codex-implementer.md` — reuse it as-is.
