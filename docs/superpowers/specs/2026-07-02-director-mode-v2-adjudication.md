# Director Mode v2 Enforcement (lask 1.3.0) — Review Adjudication Record

Written at accept time by the directing session, 2026-07-02. Companion to
`2026-07-02-director-mode-v2-enforcement.md` (design) and the 1.2.0 record
`2026-07-02-director-mode-adjudication.md`.

Review setup: builder self-test (12 behavior cases) → independent verifier
(all 10 acceptance criteria executed, incl. adversarial fail-open cases and
two live E2E runs with the double-gated dispatch-proof, 4/4) → director
personal review of the diff → Codex second opinion (gpt-5.5, read-only
sandbox: 3 High / 3 Medium / 1 Low + test-gap list). Director candidates
from personal review (session_id sanitization; trailing-newline off-by-one)
converged with Codex Medium/High items and are folded in below.

## Adopted (6)

| Finding | Reason |
|---|---|
| Cleanup sweeps the shared `${CLAUDE_PLUGIN_DATA}` root (Codex High) | Real bug: any unrelated plugin-data file >7 days old would be unlinked on every edit. Fixed with BOTH a dedicated `enforce/` subdir and an extension filter (`\.(json|handson)$`). |
| `session_id` unsanitized in filenames (Codex Medium; = director candidate) | Traversal-shaped id escapes `stateDir` via `path.join`; verifier's adversarial case only failed open by accident of nonexistent intermediate dirs. Whitelist-filtered to `[A-Za-z0-9_-]`. |
| Edit size ignores deletions (part of Codex High #3) | `new_string: ""` deleting 200 lines counted as trivial. Edit size is now `max(old_string, new_string)` lines. |
| Trailing-newline off-by-one (director candidate; Codex adjacent) | A 10-line block ending in `\n` counted as 11 and struck. `lineCount` strips one trailing newline. |
| No stdin `error` handler (part of Codex Low) | A stream error could exit non-zero. One-line handler exits 0. |
| NotebookEdit non-string `new_source` (Codex Medium) | Existing behavior (counts 0, lenient) is fail-open-consistent; adopted as a TEST only, no code change. |

## Rejected (6)

| Finding | Reason |
|---|---|
| Hands-on flag is self-creatable by the model (Codex High) | Enforcement is drift-prevention discipline tooling, not an adversarial security boundary. The Bash bypass has been a documented, accepted gap since the v1 design (failure-modes table); hardening the flag file while Bash stays open is security theater. Recorded in the v2 design doc's failure modes instead. |
| State-file race, no locking (Codex Medium) | Accepted imprecision: last-writer-wins can only UNDERCOUNT strikes, erring toward leniency, never toward wrongly blocking. Locking on Windows for an advisory nudge system is over-engineering. |
| `replace_all` special-casing (part of Codex High #3) | The 10-line/1-file rule is a proxy for "trivial", not an exact labor meter; a single-file replace_all rename is within the director's remit. Same reasoning as the 1.2.0 rejection of Codex #2 (10-line threshold prose). |
| stdin read timeout / size cap (part of Codex Low) | `hooks.json` `timeout: 10` already bounds a stalled hook; an internal timer adds complexity for no additional safety. |
| Behaviorize `content.test.mjs` (Codex test-gap note) | Layering is deliberate: content invariants check wiring/claims, `enforce.test.js` checks behavior (19 cases). |
| Automated installed-hook enforcement E2E (Codex test-gap note) | Headless enforcement E2E is flaky and token-costly; live verification is performed manually in the first post-install session instead. |

## Fix-wave verification

Post-fix: `enforce.test.js` 19/19 (7 new cases covering every adopted fix),
`tier.test.js` 23/23, `content.test.mjs` 16/16; diff confined to the declared
file set; README/SKILL.md/design-doc flag path updated to
`<CLAUDE_PLUGIN_DATA>/enforce/<session_id>.handson`.

One dispatch-spec erratum for the record: the build dispatch named
`plugins/lask/README.md`, which does not exist; the operative README (read by
the content invariants) is the repo root `README.md`. The builder's deviation
to the root README was correct and is confirmed.
