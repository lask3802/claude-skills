# Director Mode — Design (lask 1.2.0)

Date: 2026-07-02
Status: approved by user (interactive brainstorming session)

## Problem

lask 1.1.0 tiering governs *which model a spawned agent gets*, but nothing makes
the main session spawn agents at all. With fable as the main-loop model and its
quota scarce, four pain points (user-confirmed, all four):

1. **Main session still does the work itself.** The policy only fires when
   delegation happens; delegation rarely happens. Fable burns quota on
   implementation and file-reading that opus handles fine.
2. **Dispatch cost is high.** Every spawn needs a hand-written long prompt;
   there are no ready-made roles.
3. **Report quality is inconsistent.** Agents return unstructured output;
   fable re-reads everything to judge it, erasing the savings.
4. **Tier rules are rigid.** Type-based tables ignore stakes/context. Fable
   dispatch is miscalibrated in both directions: sometimes too many fable
   agents, sometimes important tasks land on opus without a fable-grade
   assign→build→review loop.

Target operating model: **fable = director** — decisions, review, completeness
/detail/sense checks, user communication. **opus = execution** — implementation,
research, data gathering. v1 is guidance-only (user decision); hook enforcement
of main-session behavior is deferred to v2.

## Approaches considered

1. **Constitution + roster + playbooks (chosen).** Behavior layer (SessionStart
   injection), pre-built agent roster with a uniform report protocol, and
   per-scenario playbook skills. Attacks all four pain points.
2. **Constitution only.** Minimal files, but leaves pain points 2 and 3
   untouched — every dispatch still needs a hand-written prompt. Rejected.
3. **Workflow-first.** Canned ultracode pipelines per scenario. Strongest
   structure, but rigid, few mid-flight decision points, and gated behind
   ultracode opt-in. Rejected as the main vehicle.

## Architecture

Three layers inside `plugins/lask/`, plus the retained 1.1.0 enforcement hooks.

### Layer 1 — Constitution: `hooks/scripts/director-context.js`

Replaces `tier-context.js` (hooks.json path updated; same SessionStart matcher
`startup|clear|compact`). Injects ~600 tokens (measured; the roster and
calibration table are load-bearing and worth the recurring cost):

- **Role**: main session (usually fable) is the director. Five duties:
  understand, decide, dispatch, verify, communicate. It does not implement.
- **Direct-work threshold**: the main session may itself (a) read a few key
  files to form judgment, (b) make trivial single-file edits ≤10 lines,
  (c) talk to the user. Everything else — multi-file implementation, broad
  searches, test loops, mechanical rewrites, doc generation — is dispatched.
- **Roster**: one line listing the seven agents and when to use each.
- **Calibration table** (replaces the rigid type table): per dispatch, two
  independent decisions —
  - *Executor model*: mechanical → sonnet/Explore; normal engineering → opus;
    execution itself needs deep multi-constraint judgment (rare) → fable with
    stated justification.
  - *Verification strength*, by impact × reversibility × subtlety ×
    upstreamness: low → implementer self-test suffices; medium → dispatch
    verifier; high (hard to roll back, failure is hidden, later work stacks
    on it) → fable reviews personally, optionally adding a cross-model
    second opinion (Codex via `second-opinion`) whose findings fable
    adjudicates one by one.
- **Anti-patterns**: "faster to do it myself" (snowballs), "fable to be safe"
  (add verification, not model size), "accept opus output unverified".
- Pointer to `lask:director` for the full rubric.

### Layer 2 — Roster: `agents/*.md`

Format verified against an installed working example
(`openai-codex` plugin `agents/codex-rescue.md`): YAML frontmatter `name`,
`description`, `model`, `tools` (comma-separated), optional `skills`; body is
the agent's system prompt. Invoked as `subagent_type: "lask:<name>"`.
`tier-agent.js` already passes `:`-namespaced types through untouched, so the
roster self-governs its models.

| Agent | model | tools | Mandate |
|---|---|---|---|
| `scout` | opus | read-only (no Edit/Write) | Internal recon: read code, map structure/dependencies/current state; return a distilled brief so fable never bulk-reads files |
| `researcher` | opus | read-only + WebSearch/WebFetch | External research: docs, APIs, ecosystem comparisons |
| `implementer` | opus | full | Build to spec; **self-test duty** (run tests/build, attach evidence) |
| `debugger` | opus | full | Systematic root-cause investigation; report cause, evidence chain, fix options; no unilateral large changes |
| `verifier` | opus | run commands, no file edits | Acceptance officer: check the dispatch's acceptance criteria item by item; report facts only. Deliberately separate from implementer — builders don't grade their own work |
| `reviewer` | opus | read-only | First-pass review: correctness/risk/style, severity-ranked findings; fable reads only high-severity + spot checks |
| `second-opinion` | sonnet | Bash, Read | Third-party cross-model review: thin wrapper that runs the Codex CLI (`codex exec --sandbox read-only --output-last-message <file>`) against a spec/plan/diff and relays findings faithfully — it holds no opinion of its own and makes no adoption decisions. Exists because plans finished by one model family share blind spots; a different model catches them. Direct CLI use avoids the codex-rescue relayed-authorization gate |

Every agent body embeds the same two contracts, tailored per role:

**Input contract** (what a dispatch prompt must contain — the "four-piece
set"): goal, scope (files to touch / not touch), constraints, acceptance
criteria. Acceptance criteria double as the verifier's checklist.

**Report protocol** (fixed final-message structure):

```
## Verdict        — one paragraph, outcome first
## Evidence       — commands run, files inspected, results (verifiable)
## Changes        — file:line list (implementer/debugger only)
## Self-assessment — completion %, confidence, known risks / untouched edges
## Open questions — items needing a director decision
```

Two hard rules inside the protocol:
- **File references are always `path:line`** (clickable in Claude Code). Never
  paste multi-line code excerpts when a reference suffices — saves tokens,
  keeps review one click away. Applies to all agents (especially reviewer
  findings) and to the main session's own reports to the user.
- **Artifacts to files, summaries in reports**: long output (full analyses,
  diff walkthroughs) goes to a file (scratchpad or repo doc as appropriate);
  the report carries the summary plus the file path.

### Layer 3 — Playbooks: skills

`skills/director/SKILL.md` — the full rubric (absorbs and deletes
`model-tiers`): operating loop (Understand → Decide → Dispatch → Verify →
Judge → Report), calibration table with worked examples, dispatch four-piece
template, parallel-dispatch guidance, when fable dispatch is legitimate and
the brake on overuse, expanded anti-rationalization table, hook behavior
(rewrite defaults, workflow model requirement, `tier: reviewed` escape hatch).

`skills/delegation-playbooks/SKILL.md` — five scenarios, each with standard
loop, ready dispatch templates, and escalation points (when to raise
verification strength):

| Scenario | Loop |
|---|---|
| feature | scout ∥ researcher → fable specs → **second-opinion on the spec (cross-model), fable adjudicates** → implementer → verifier → fable final review only if high-stakes |
| bugfix | debugger root-cause → fable picks fix → implementer → verifier (incl. regression) |
| research | researcher ∥ scout fan-out → fable synthesizes |
| refactor | scout maps blast radius → fable sets strategy → implementer in batches → verifier proves behavior unchanged |
| review | reviewer ∥ second-opinion (independent, parallel) → fable merges, reads high-severity + spot checks → verdict |

**Cross-model review protocol** (in the director skill): after fable finishes
a plan/spec (the "企畫 done" moment) or before accepting a high-stakes change,
dispatch `second-opinion`; fable then adjudicates each finding explicitly —
adopt / reject with a stated reason, never blanket-accept ("Codex said so" is
not a reason) and never silently drop.

### Retained hooks (1.1.0, adjusted)

- `tier-agent.js` — unchanged (no `model` → Explore→sonnet, others→opus;
  explicit model and `:`-types respected).
- `tier-workflow.js` — logic unchanged; deny message now cites
  `lask:director` instead of `lask:model-tiers`.
- `hooks.json` — SessionStart entry points to `director-context.js`.

## Failure modes

| Failure | Behavior |
|---|---|
| Main session ignores guidance (v1 has no enforcement) | Accepted by design; injection re-fires on compact; v2 adds hooks |
| Agent defs updated but session already running | Plugin content loads at session start; changes need a new session (documented in README) |
| node not on PATH | Hooks no-op non-blocking (unchanged from 1.1.0) |
| Roster agent misused (e.g. verifier asked to fix) | Tool restrictions in frontmatter make violations fail loudly |

## Testing

The plugin is production software; three test layers (all plain Node, no deps):

1. **Hook behavior** — `hooks/scripts/tier.test.js` (existing runner, updated):
   pipes PreToolUse/SessionStart JSON through each script; director-context.js
   emits valid hookSpecificOutput; tier-workflow.js deny text cites
   `lask:director`; existing tier-agent/tier-workflow cases unchanged.
2. **Content invariants** — `tests/content.test.mjs` (`node --test`, same
   pattern the openai-codex plugin uses): plugin.json/hooks.json parse and
   point at existing files; exactly seven `agents/*.md` with the exact name
   set; every agent frontmatter has name (= filename), description, model ∈
   {sonnet, opus} (never fable), and every body carries the report protocol,
   the `path:line` rule, and the input contract; `second-opinion` embeds the
   verified `codex exec --sandbox read-only` recipe; skills director +
   delegation-playbooks exist, model-tiers is gone; director names all seven
   agents; README documents agents and test commands.
3. **Headless E2E** — `tests/e2e.test.mjs`, gated by `LASK_E2E=1` (costs
   tokens): runs `claude --plugin-dir <repo>/plugins/lask --model sonnet -p`
   against the WORKING COPY (pre-install, session-only plugin load) and
   asserts (a) the `<lask-director-policy>` block is in context, (b) the
   `lask:*` agents are listed as available, (c) the lask skills are
   registered. After install, the same suite without `--plugin-dir` smokes
   the user-scope installation.

## Install

1. `plugin.json` → 1.2.0; README updated; commit + push (noreply email).
2. `claude plugin marketplace update claude-skills`, then
   `claude plugin update lask@claude-skills` (user scope).
3. Post-install smoke: cache shows 1.2.0; `LASK_E2E=1` suite passes against
   the installed plugin (no `--plugin-dir`).
4. Update auto-memory (marketplace entry + tiering-policy entry).

## Out of scope / v2

- **Enforcement hooks** on main-session Edit/Write (remind, then deny with
  escape hatch). Requires verified discrimination of main-session vs subagent
  tool calls in hook input; doc research is underway separately and its
  findings will be recorded before v2 is designed. v1 is independent of it.
- Toggle machinery (hands-on mode flag). In guidance-only v1, the user just
  says so in chat.
- Changing or capping the main-loop model (unchanged from 1.1.0).
