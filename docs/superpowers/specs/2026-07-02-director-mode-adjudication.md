# Director Mode (lask 1.2.0) — Final Review Adjudication Record

Source: `.superpowers/sdd/progress.md` (gitignored build ledger for the lask 1.2.0
director-mode branch, dated 2026-07-02). This doc transcribes that ledger's
review-adjudication entries verbatim in substance so the decision history
survives a fresh clone, where the ledger itself does not.

Related docs:
- Design: `2026-07-02-director-mode-design.md`
- Plan: `docs/superpowers/plans/2026-07-02-director-mode.md`

This is a transcription, not a re-analysis. Where the ledger's stated reason
for a verdict is terse, absent, or ambiguous, that is noted explicitly below
rather than filled in.

## 1. Final review (fable) — verdict: "With fixes"

The fable final review (post Task 5, pre Task 6) returned one Important
finding and a set of minors, plus a disposition on two previously-deferred
items and on six minors deferred from earlier task reviews (section 3).

| # | Finding | Verdict | Recorded reason |
|---|---|---|---|
| Important | `marketplace.json` needed the 1.2.0 version bump + description update + a version-sync invariant | **ADOPT** | "plan gap" — the plan did not account for this; treated as a real gap, not a style nit. |
| Minor 2 | Add the "Changes (builders only)" phrase to `director-context.js` and the director skill | **ADOPT** | No reason recorded beyond the label itself — ledger does not explain *why*, only *what*. |
| Minor 3 | Spec amendment: input-contract placement | **ADOPT** | "doc-only" — recorded as the rationale, i.e. adopted because the change carries no code risk. |
| — | E2E plural-skills assertion (add now) | **REJECT** (deferred, not a hard no) | "queue for next E2E change" — not rejected on merits, deferred to the next change that touches the E2E suite. |
| — | Deny-text "top of script" wording | **REJECT** | "pre-existing, conservative-correct" — existing wording judged already correct; no change needed. |

Note: the ledger's two ADOPT items are numbered "Minor 2" and "Minor 3"; no
"Minor 1" appears anywhere in the fable review section of the ledger. This
gap in the numbering is preserved as-is rather than invented or renumbered.

## 2. Codex second opinion — 11 findings adjudicated

The ledger records this as a single line-item list per verdict, not a
per-finding table. Reproduced below by finding number, preserving the
ledger's exact reason text.

**ADOPT (as listed in the ledger, in ledger order):**

| Finding | Recorded reason |
|---|---|
| #5 — stdin-safe codex recipe | "empirically hit: first call hung on open stdin, exit 143" — adopted because the failure mode was actually reproduced, not theoretical. |
| #7 — retry wording | No reason recorded beyond the label. |
| #8 — "Changes (builders only)" | "[= fable convergence]" — adopted because it independently converged with the fable review's Minor 2. |
| #6 — "as doc-note only" | No reason recorded beyond the label. See numbering note below. |
| #10 — Task-6 dispatch-proof (not e2e edit) | Adopted in an alternate form: implemented as a Task-6 dispatch-proof rather than as an edit to the e2e test itself. The original e2e-edit framing is separately queued (see below). |
| #4a — spec amendment | "[= fable convergence]" — adopted because it independently converged with the fable review's Minor 3. |
| #3 — spec wording fix | No reason recorded beyond the label. |

**REJECT (as listed in the ledger, in ledger order):**

| Finding | Recorded reason |
|---|---|
| #1 — guidance-only framing | "deliberate v1 scope, spec failure-modes records it" — the guidance-only approach was an intentional v1 boundary, already documented in the spec's failure-modes section. |
| #2 — 10-line threshold prose | "v1 limit, anti-rationalization table targets it" — the 10-line threshold is a deliberate v1 limit; the anti-rationalization table already addresses the underlying concern. |
| #4b — implementer self-derived criteria | "disclosure beats stalling" — rejected in favor of letting an implementer proceed with disclosed, self-derived criteria rather than stall for missing input. |
| #9 — tier-workflow relief valves | "1.1.0 deliberate, tested" — the 1.1.0 behavior was an intentional, already-tested design choice. |
| #11 — ToolSearch | "real tool in this harness, graceful degradation" — ToolSearch is a real tool in this harness and already degrades gracefully, so no change needed. |
| #6 — model pinning | "operator's codex config is their choice" — rejected as outside this project's authority; the operator's own Codex configuration is their call. |

**Numbering note (ledger inconsistency, preserved rather than resolved):**
Finding **#6** appears on *both* the ADOPT list ("#6 as doc-note only") and
the REJECT list ("#6 model pinning"), describing two unrelated topics. Every
other multi-verdict finding in the ledger (#4) is explicitly split into
sub-labels `4a`/`4b` to show a partial adopt/partial reject disposition. #6
carries no such sub-label, which suggests either (a) codex finding #6
genuinely bundled two unrelated recommendations under one number and the
ledger recorded both dispositions without sub-labeling them, or (b) one of
the two "#6" references is a transcription slip for a different finding
number in the ledger. The source ledger does not disambiguate this, and no
finding number 12+ exists to reassign it to, so both occurrences are
reproduced verbatim above rather than merged or renumbered.

**Queued for the next E2E-touching change** (ledger, verbatim substance):
- Plural-skills assertion (fable's finding, referenced here as "fable #4" in
  the ledger — note this is the fable review's own internal numbering, not
  one of the 11 Codex findings).
- Dispatch-proof written directly into the e2e test itself (Codex #10's
  original framing, as distinct from the Task-6 dispatch-proof that was
  adopted as its substitute — see #10 above).

### Actual counts (verified against the ledger)

Counting each ADOPT/REJECT list-entry as written: **7 ADOPT entries** and
**6 REJECT entries**, covering **11 distinct finding numbers** (#1–#11).
This does not reduce cleanly to a single adopted/rejected count per finding
because two finding numbers carry a split disposition:

- **#4** is explicitly split by the ledger itself (`4a` adopted, `4b`
  rejected) — one finding, two sub-verdicts.
- **#6** appears once on each list with no sub-label (see numbering note
  above) — one finding number, two unreconciled verdicts.

Treating the other 9 findings as single-verdict: **5 adopted** (#3, #5, #7,
#8, #10), **4 rejected** (#1, #2, #9, #11), plus the two split/ambiguous
findings (#4, #6) that each contribute one adopt-line and one reject-line.

For the record: the build session's own handoff summary (2026-07-02) reported
the tally as "採納 6、駁回 5" (6 adopted / 5 rejected), which matches the
above if each split finding is tallied once — one toward each column. That
summary is a hint for interpretation, not a resolution of the #6 ambiguity.
This is reported as-is; it does not match a clean 6-adopted/5-rejected split
without arbitrarily assigning #4 and #6 each to a single side, which the
ledger's own text does not support doing.

## 3. Deferred minors from earlier task reviews — resolved at final review

The ledger records six minors deferred during Task 3, Task 4, and Task 5
reviews, explicitly held for "final review triage." The final review line
disposes of all six in one sentence: **"Deferred minors 1-6: all accepted
per triage."** No additional per-item reasoning is recorded beyond what was
already noted at the task level (reproduced below); the final review's own
contribution is only the accept decision itself.

From Task 3 review:
1. `content.test.mjs:48` asserts `/## Verdict/` presence, not Verdict-led ordering.
2. path:line guard looser than prose ("clickable" only enforced in 2/7 bodies; the rule itself is present in all 7).
3. Unused `export` on `read`/`parseFrontmatter` (both are same-file appenders, so the export is unnecessary).

From Task 4 review:
4. History attribution: the model-tiers deletion is physically present in commit `8387f70`, but message credit for it landed in `c49e580` (ledger notes: unpushed at the time, tree state correct, no rebase performed).
5. Unanchored regex in appended tests (matching on `## ` headings / `lask:name` substrings) — noted as latent-only, i.e. not currently causing a failure.

From Task 5 review:
6. E2E header comment shows a broken dir-form command (ledger: "fixing now"); path-with-spaces latent fragility (ledger: "accepted, documented").

**Verdict for all six: ADOPT** (accepted per final-review triage), reason as
stated: "per triage" — the ledger does not record separate reasoning beyond
the acceptance decision itself for this batch.

## 4. Task-level adjudicated finding (pre-final-review)

One further finding was adjudicated and resolved before the final review,
recorded against Task 1:

- **Finding:** Injected policy measured at ~600 tokens vs. the plan's stated
  "~450."
- **Verdict:** **ADOPT** as a doc fix; policy content itself was kept
  unchanged.
- **Reason:** Not elaborated beyond "adopt as doc fix, keep content." Fixed
  in a follow-up commit (ledger does not name the commit hash for this one).

## 5. Fix wave outcome (context, not a separate adjudication)

Per the ledger: a single fix wave was dispatched covering 6 fixes, including
the fable Important finding (`marketplace.json`). It completed as commit
`ca9cf98`, touching 7 files, "self-verified by controller against verbatim
fix specs." The ledger does not break the 6 fixes down item-by-item beyond
what is already listed in sections 1–3 above.
