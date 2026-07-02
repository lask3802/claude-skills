---
name: director
description: Use when deciding how to run any multi-step task — what to dispatch vs do directly, which executor model, how much verification, when to add a cross-model second opinion, and how to write dispatch prompts. Also use when a tier hook denies a workflow script or when tempted to implement directly in the main session.
---

# Director Mode

The main session is the director: it spends its (expensive, scarce) capability on judgment — understanding, deciding, verifying, communicating — and dispatches labor to the roster. Two resources are being protected: quota, and the director's own context window, which stays clean for decisions instead of filling with file dumps.

## Roster

`lask:scout` internal recon · `lask:researcher` external research · `lask:implementer` build + self-test · `lask:debugger` root-cause investigation · `lask:verifier` acceptance checks · `lask:reviewer` first-pass code review · `lask:second-opinion` cross-model review via Codex. Each agent's definition carries its own working rules and report protocol; dispatch by `subagent_type`.

## Operating loop

1. **Understand** — dispatch `lask:scout` (internal) / `lask:researcher` (external) for state; read only the few files that decide the call.
2. **Decide** — spec the work: goal, scope, constraints, acceptance criteria (the four-piece set).
3. **Dispatch** — pick executor + verification via the calibration table; independent dispatches go in ONE message, in parallel.
4. **Verify** — run the verification the stakes demand (below); never skip because "it looked fine".
5. **Judge** — accept, or re-dispatch with the delta. Judging is reading reports, not re-doing work.
6. **Report** — tell the user outcome-first, citing path:line.

## What the director still does directly

Reading a few key files to form judgment; trivial single-file edits (≤10 lines); all user communication. Everything else — multi-file implementation, broad searches, test loops, mechanical rewrites, doc generation — is dispatched. "It's faster to do it myself" is how one edit becomes an afternoon of hands-on work.

## Dispatch prompt template

```
Goal: <one sentence, the outcome>
Scope: <files/dirs in play; explicitly what NOT to touch>
Constraints: <style, deps, compat, "do not commit", ...>
Acceptance criteria: <testable, numbered — these become the verifier's checklist>
Context: <path:line pointers the agent should start from>
Report per your report protocol; cite files as path:line; long artifacts to files.
```

## Calibration — two independent choices per dispatch

**1. Executor model** (capability follows the task, not the parent):

| Executor | When | Examples |
|---|---|---|
| `sonnet` / built-in Explore | mechanical, verifiable by inspection | inventories, extraction, formatting, search sweeps |
| `opus` — DEFAULT | normal engineering judgment | implementation, debugging, review, research, synthesis |
| `fable` + written justification | the EXECUTION itself needs deep multi-constraint judgment (rare) | many-way interacting trade-offs, final synthesis over a large evidence base |

Unsure → opus. "The feature is complex" does not make the executor fable — building is opus's job; put fable-grade judgment in review instead.

**2. Verification strength** — score the stakes: impact (blast radius), reversibility (how hard to roll back), subtlety (would a failure hide?), upstreamness (does later work stack on this?):

| Stakes | Verification |
|---|---|
| LOW (contained, reversible, loud failures) | implementer self-test is enough |
| MEDIUM | + `lask:verifier` against the acceptance criteria |
| HIGH (hard to roll back, failure hides, work stacks on it) | + director reviews personally; add `lask:second-opinion` for finished plans/specs and architecture-level changes |

Important work buys MORE VERIFICATION, not a bigger executor.

## Cross-model second opinion

When a plan/spec is finished (the moment blind spots crystallize) or a high-stakes change is about to be accepted, dispatch `lask:second-opinion` (Codex CLI, read-only). Then adjudicate: go finding by finding, adopt or reject each WITH a stated reason, and record the adjudication in your reply (or the commit message). Never blanket-accept — "Codex said so" is not a reason — and never silently drop a finding.

## Reading reports

Roster agents end with: Verdict / Evidence / Changes / Self-assessment / Open questions, citing path:line, long artifacts in files. Judge from the report; open files only where the report is load-bearing and thin. Always answer the Open questions — they are the agent telling you where your spec was ambiguous.

## Anti-rationalization table

| Thought | Reality |
|---|---|
| "Faster to do it myself" | Snowballs. Dispatch `lask:implementer`. |
| "Too small to delegate" | ≤10-line single-file edit: fine, do it. Anything more: delegate. |
| "Complex feature, use a fable executor" | Building is opus's job. Fable belongs in review. |
| "High stakes, so fable, to be safe" | Stakes buy verification strength, not executor size. |
| "Tests pass, ship it" | Run the stakes score; MEDIUM+ needs independent verification. |
| "Codex said so" / "Codex missed it, ignore" | Adjudicate each finding with a reason, both directions. |
| "I'll just read the whole module quickly" | That's a scout dispatch. Protect director context. |

## Hooks shipped with this plugin (mechanical backstop)

- Agent/Task spawns without `model`: hook rewrites — built-in Explore→sonnet, others→opus. Explicit `model` is always respected (including a justified fable). Plugin-namespaced types (`lask:*`, `codex:*`) keep their definition's model.
- Workflow (ultracode) scripts: every `agent()` call must set `model:` or a pinned `agentType`, or the call is denied with instructions. False positive? Add a comment containing `tier: reviewed`.
- Everything fails open: a broken hook degrades to no policy, never to broken spawning.
