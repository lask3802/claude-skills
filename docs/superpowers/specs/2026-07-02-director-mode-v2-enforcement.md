# Director Mode v2 — Enforcement Layer (lask 1.3.0)

Date: 2026-07-02
Status: implemented
Prior art: `2026-07-02-director-mode-design.md` (v1 constitution/roster/playbooks —
"Out of scope / v2" names this layer); grounded in
`2026-07-02-hooks-capability-notes.md` (capability research; corrections below).

## Problem

v1 is guidance-only: the `<lask-director-policy>` injection *asks* the main session to
dispatch implementation labor, but nothing makes it. With fable as the main-loop model
and its quota scarce, the main session still edits files directly. v2 adds a mechanical
backstop on main-session file edits: nudge, then deny, with an escape hatch — without
ever breaking editing when something goes wrong.

## Scope

One new PreToolUse hook, `hooks/scripts/director-enforce.js`, matched on
`^(Edit|Write|NotebookEdit)$`. The v1 constitution (`director-context.js`) stays
stable: it educates once per session; the enforcement messages educate in-situ. No
change to `tier-agent.js` / `tier-workflow.js` logic.

## Decision ladder

Per PreToolUse call, in order (first match wins; any error short-circuits to fail-open):

1. **stdin unparseable** → exit 0, no output.
2. **`agent_id` present** (subagent call) → exit 0, no output. Subagent labor is the
   intended path and is never counted.
3. **`session_id` missing / not a string** → exit 0, no output (no key to track state).
4. **`tool_input` missing / not an object** → exit 0, no output.
5. **hands-on flag file exists** (`<stateDir>/<session_id>.handson`) → exit 0, no output.
6. Measure the edit and fold the file into the session's distinct-file set, then:
   - **trivial** — `size ≤ MAX_TRIVIAL_LINES` AND `distinct ≤ FREE_FILES` → allow
     silently, **no strike** (state still persisted so the file set stays current).
   - **otherwise** — `strikes++`, persist, then:
     - `strikes ≤ NUDGE_STRIKES` → `permissionDecision: "allow"` **with**
       `additionalContext` (a factual nudge).
     - `strikes > NUDGE_STRIKES` → `permissionDecision: "deny"` with
       `permissionDecisionReason`.

"Size" = line count of the edit. For `Edit` it is `max(lineCount(old_string),
lineCount(new_string))` so a large *deletion* (e.g. `new_string: ""` removing 200 lines)
is not treated as trivial; `Write` measures `content`, `NotebookEdit` measures
`new_source` (a missing or non-string field counts as 0 lines). `lineCount` strips one
trailing newline before splitting, so a 10-line block ending in `\n` counts as 10, not
11. "File identity" = `tool_input.file_path` or `tool_input.notebook_path`.

## Constants (top of `director-enforce.js`)

| Constant | Value | Meaning |
|---|---|---|
| `MAX_TRIVIAL_LINES` | 10 | an edit at/under this many lines can be direct... |
| `FREE_FILES` | 1 | ...to at most this many distinct files per session |
| `NUDGE_STRIKES` | 2 | strikes 1–2 nudge; strike 3+ denies |
| `STATE_TTL_DAYS` | 7 | opportunistic cleanup horizon for session state files |

## State

`<stateDir>/<session_id>.json` = `{ files: [distinct file paths], strikes: N }`, updated
every non-error call. The base dir is `argv[2]` (hooks.json passes
`"${CLAUDE_PLUGIN_DATA}"`); if it is missing, empty, or still contains a literal `${`
(unsubstituted), the base falls back to `os.tmpdir()/lask-director-enforce`. `stateDir`
is a dedicated `enforce/` subdirectory of that base (`path.join(base, 'enforce')`), so
opportunistic cleanup never touches the shared plugin-data root — and cleanup only
unlinks files whose name matches `/\.(json|handson)$/`, so even inside `enforce/` an
unrelated file is safe. `session_id` is sanitized (`replace(/[^A-Za-z0-9_-]/g, '_')`)
before any filename use, so a traversal-shaped id cannot escape `stateDir` (the sanitized
path is what the message discloses). `mkdir -p` is best-effort; a genuinely unwritable
dir (including a base path that is actually a file) surfaces at the state write and fails
open. Opportunistic cleanup deletes matching state files older than `STATE_TTL_DAYS`
(best-effort, wrapped in try/catch).

## Escape hatch (hands-on mode)

When the user authorizes hands-on work, creating
`<CLAUDE_PLUGIN_DATA>/enforce/<session_id>.handson` (i.e. `<stateDir>/<session_id>.handson`)
exempts that session entirely (step 5 above). The exact absolute path is printed in every
nudge and deny message so it can be created without guesswork. It is per-session, so it
lapses when the session ends and is swept by the TTL cleanup.

## Message style (why factual statements, not commands)

`additionalContext` injects model-facing text next to the tool result. Per the official
warning, out-of-band text phrased as an imperative system command trips Claude's
prompt-injection defenses and gets surfaced to the *user* instead of steering the
*model*. Both the nudge and the deny text are therefore written as **factual
statements** — "this session has recorded N…", "the existence of the flag file X
enables…" — never "do X". Each carries: the current tally (N non-trivial direct edits,
M distinct files this session), the policy reference (trivial single-file edits ≤10
lines are within the director's remit; larger implementation is normally dispatched to
`lask:implementer`), and the exact absolute hands-on flag path. The deny text adds that
the blocked call can be retried once the work is dispatched or hands-on mode is enabled.

## Fail-open contract

Any error anywhere — parse failure, missing fields, fs errors, unwritable state dir —
exits 0 with no output. The hook never exits non-zero and never throws past its top
handler. A broken enforcement hook degrades to *no policy*, never to blocked editing.
This is proven by behavior cases 7 (malformed stdin), 8 (missing session_id), and 10
(unsubstituted `${CLAUDE_PLUGIN_DATA}` → tmp fallback still functions).

## Registration

`hooks/hooks.json` gains a third PreToolUse entry, matcher `^(Edit|Write|NotebookEdit)$`
(anchored — an unanchored `Edit` would substring-match other tool names), command
`node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/director-enforce.js" "${CLAUDE_PLUGIN_DATA}"`,
following the escaped-double-quote quoting the existing entries use to tolerate spaces.

## Tests

- `hooks/scripts/enforce.test.js` — 12 piped-JSON behavior cases (hand-rolled runner,
  same pattern as `tier.test.js`), isolated temp state dir via argv, unique session ids.
- `tests/content.test.mjs` — invariants: hooks.json wires an anchored director-enforce
  entry pointing at an existing script and passing `${CLAUDE_PLUGIN_DATA}`; plugin.json
  version (1.3.0) equals the marketplace lask-entry version; README documents the hook
  and the `enforce.test.js` command; director SKILL.md hooks section documents the hook
  and the hands-on escape hatch.
- `tests/e2e.test.mjs` — the skills probe now asserts BOTH `lask:director` and
  `lask:delegation-playbooks`. An optional live dispatch-proof (headless `lask:scout`
  echoing a sentinel) is double-gated behind `LASK_E2E=1` + `LASK_E2E_DISPATCH=1` so it
  never runs in the default suite.

## Corrections to `2026-07-02-hooks-capability-notes.md`

The capability notes flagged several claims as summarizer-only or observed-not-documented.
Re-checked against the official docs, the enforcement layer rests on these confirmations:

1. **`agent_id` present only in subagents is now officially documented**, not just
   observed. The field's own description reads "Present only when the hook fires inside a
   subagent call." This is the load-bearing main-session-vs-subagent discriminator (step 2).
2. **`defer` is headless-only.** A `defer` permission decision exists but applies to the
   non-interactive `-p` / Agent SDK path only; interactive enforcement has
   `allow` / `deny` / `ask`. v2 uses `allow` (with `additionalContext`) and `deny` — both
   valid interactively — precisely because `defer` is unavailable in the interactive main
   session this hook governs.
3. **PreToolUse `additionalContext` injects "next to the tool result" and merges across
   hooks.** It is combinable with an `allow` decision (a non-blocking nudge), and multiple
   hooks' `additionalContext` are concatenated. The official warning requires
   factual-statement phrasing (see "Message style").
4. **Marketplace top-level `version` is the "Marketplace manifest version",** independent
   of plugin update detection. Plugin updates are detected via the plugin's own
   `plugin.json` version → the marketplace *entry* version → commit SHA (in that order).
   Hence 1.3.0 bumps `plugin.json` and the lask marketplace **entry**, and deliberately
   leaves `metadata.version` / top-level `version` (1.0.0) untouched.

## Failure modes

| Failure | Behavior |
|---|---|
| node not on PATH | hook no-ops (unchanged from prior hooks) |
| state dir unwritable / base is a file | fails open at the state write → no output, editing proceeds |
| corrupt session state file | treated as no prior state; starts fresh (not an error) |
| traversal-shaped `session_id` | sanitized to `[A-Za-z0-9_-]`; cannot escape `stateDir` |
| session runs > 7 days | old state (incl. a stale `.handson`) swept; re-nudges from zero |
| subagent edits | `agent_id` present → never counted (the intended labor path) |
| model self-creates the `.handson` flag (or bypasses via `Bash` — the v1-accepted gap) | Accepted by design. Enforcement is drift-prevention for a cooperative main session, NOT an adversarial security boundary; a model determined to route around it can, exactly as with the v1 tools-allowlist gap. The value is making the dispatch path the path of least resistance. |
| concurrent same-session edits race the state file | Accepted. Last-writer-wins on `<session_id>.json` can drop a strike increment; the worst case *undercounts* strikes and errs toward leniency (a missed nudge), never toward wrongly blocking a call. No locking (explicitly rejected). |
```
