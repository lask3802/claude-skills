---
name: roast
description: >-
  Use when you want a project, feature, business decision, or open 議題 torn apart by a strict but fair
  startup-incubator panel — five adversarial expert lenses (expander, first-principles, researcher,
  critic, user-advocate) that cross-examine each other and converge on ONE decisive verdict, instead of
  a single agreeable review. Trigger phrases: "roast my project / 拷打 / 嚴格 review / incubator / 孵化器 /
  挑戰這個方向 / 這值得做嗎 / 這個能賣嗎 / tear this apart / red-team this / should we build this". Also use
  before committing to a major direction, pivot, scope cut, monetization model, or launch.
---

# Roast — the incubator panel

> **OUTPUT RULE:** Your final reply is the **Incubator Roast document** (template below) — a single
> decisive verdict, not five monologues. Harsh in service of a decision, never harsh for show.

## Overview

A great founder review is a **structured adversarial-but-fair tribunal, not a Q&A**. This skill convenes
a five-member panel, each owning a distinct lens, makes them **cross-examine each other (not just the
founder)**, and forces a single owned verdict — **KILL / PIVOT / PERSEVERE / SCALE** — plus the ONE
highest-leverage thing to change. A review with ten suggestions and no priority decided nothing.

Two principles drive everything:

1. **Pre-register the bar, then judge.** State the scorecard dimensions and the kill/scale thresholds
   **before** the critique, so no one moves the goalposts at the close.
2. **Conflict is the product.** The most valuable disagreement is panelist-vs-panelist. Surface it by
   name; record dissent rather than averaging it into mush. If everyone instantly agrees, the take is
   too conventional — probe harder.

## When to use

- "Roast / 拷打 / 嚴格 review my project (or this feature / 議題 / direction)."
- Before a big commit: a pivot, a scope cut, a monetization model, a launch, a "should we even build this?"
- When you suspect you're getting agreeable feedback and want the fatal flaw found *early* and cheaply.

**When NOT to use:** a small mechanical task, a bug, or a question with one right answer. This is a
strategic stress-test, not a code review (use `/code-review`) and not a debugging session.

## Arguments

- `/lask:roast` — roast the **project's current state** (read the repo, memory, plans, git log to scope it).
- `/lask:roast <topic / 議題 / decision>` — focus the panel on that specific question (e.g. "should we
  go free-to-play?", "is the visual pass worth 2 weeks?", "is there any reason to buy this over the
  free rummy apps?"). Still load the global context so the panel is grounded.

## How to run it

### Phase 0 — Build the shared context brief (orchestrator, before spawning anyone)

Don't make five agents re-derive context. Assemble a tight brief ONCE and hand it to all of them:

- Read the project signal: `README`, design/plan/spec docs, the auto-memory if present
  (`memory/MEMORY.md` + linked files), recent `git log`, and the key source dirs. Run a cheap state
  check (does it build / what's the test count / what actually ships today).
- Write a ≤1-page brief: **what it is · who it's for · current state (verified, not aspirational) ·
  the stage (idea / MVP / launching) · the budget/runway reality · the specific 議題 if one was given.**
- **Pre-register the bar** (state it in the brief and in the final doc):
  - **Scorecard dimensions** (score each /5, evidence-anchored): (1) Problem & desirability — real
    underserved job + would-pay; (2) Differentiation & moat — vs the free/established alternative;
    (3) Expansion upside — compounding potential; (4) Focus & feasibility — scope discipline +
    architecture; (5) De-risk / survival — is the riskiest assumption tested? Weight by stage
    (early = problem/desirability heavy; launching = differentiation/survival heavy). Researcher's
    evidence quality sets the **confidence** on the whole scorecard.
  - **Verdict thresholds:** **KILL** = a FATAL flaw no cheap test can clear, or no real job, or no
    reason to pay over the incumbent. **PIVOT** = wrong wedge/audience but a viable adjacent change AND
    runway to execute it. **PERSEVERE** = promising but the key uncertainty is untested — must name the
    ONE experiment. **SCALE/SHIP** = riskiest assumption tested and held; the bottleneck is execution,
    not survival.

### Phase 1 — Spawn the five lenses in parallel

Run all five at once. **Recommended: an `ultracode` Workflow / agent team** (fastest, and it pipelines
the cross-fire). Pass each agent: the context brief + the pre-registered bar + (if given) the 議題.

Use the dedicated subagents when installed — `agentType: 'lask:expander'`, `'lask:first-principles'`,
`'lask:researcher'`, `'lask:critic'`, `'lask:user-advocate'` (drop the `lask:` prefix if your runtime
doesn't namespace plugin agents). **If they're not installed, spawn five `general-purpose` agents using
the inline roster below** — the panel must work self-contained.

Drop-in Workflow script (the recommended path):

```js
export const meta = {
  name: 'roast-panel',
  description: 'Five-lens incubator panel: critique → cross-fire → single verdict',
  phases: [{ title: 'Critique' }, { title: 'Cross-fire' }, { title: 'Verdict' }],
}
// Workflow-tool script: `meta` + top-level await/return are provided by the runtime, which also
// injects the args/agent/parallel/phase/log globals. (It is NOT a standalone Node module — do not
// wrap it in a function or `node` it directly.)
const BRIEF = args.brief          // the Phase-0 context brief + pre-registered bar
const TOPIC = args.topic || "Review the project's current state and whether it's worth building/buying."
const LENSES = ['expander', 'first-principles', 'researcher', 'critic', 'user-advocate']
// Use the dedicated lask:<lens> subagents when installed; fall back to general-purpose otherwise.
// When falling back (args.useLaskAgents === false), prepend each lens's roster blurb (below) to its
// prompt so the panel stays self-contained with zero agents installed.
const agentTypeFor = (l) => (args.useLaskAgents === false ? 'general-purpose' : `lask:${l}`)

phase('Critique')
const round1 = await parallel(LENSES.map((l) => () =>
  agent(`${BRIEF}\n\nTOPIC: ${TOPIC}\n\nReview from your lens. Follow your required output shape, incl. your scorecard line and your Cross-fire challenges to other panelists by name.`,
    { label: `critique:${l}`, phase: 'Critique', agentType: agentTypeFor(l) }).then((t) => ({ lens: l, text: t }))
)).then((r) => r.filter(Boolean))

phase('Cross-fire')
const round2 = await parallel(round1.map((self) => () => {
  const others = round1.filter((o) => o.lens !== self.lens).map((o) => `### ${o.lens}\n${o.text}`).join('\n\n')
  return agent(`${BRIEF}\n\nYou are the ${self.lens} panelist.\n\nYOUR ROUND 1 TAKE:\n${self.text}\n\nTHE OTHER FOUR PANELISTS' TAKES:\n\n${others}\n\nNow do cross-examination, not a re-do. Respond ONLY to the challenges aimed at you (search for your lens name) and the 1-2 points you most disagree with. For at least two specific named claims, output one line each: \`CLAIM → CONCEDE | REBUT | REFRAME → the evidence\`. Concede ONLY if they presented disconfirming evidence; never concede to confidence. Keep it short and sharp.`,
    { label: `crossfire:${self.lens}`, phase: 'Cross-fire', agentType: agentTypeFor(self.lens) }).then((t) => ({ lens: self.lens, text: t }))
})).then((r) => r.filter(Boolean))

phase('Verdict')
const chair = await agent(
  `${BRIEF}\n\nYou are the CHAIR of the incubator panel. Inputs:\n\nROUND 1 (critiques):\n${round1.map((o)=>`## ${o.lens}\n${o.text}`).join('\n\n')}\n\nROUND 2 (cross-fire):\n${round2.map((o)=>`## ${o.lens}\n${o.text}`).join('\n\n')}\n\nProduce the final Incubator Roast document. Rules: (1) consolidate the five self-scores into the pre-registered 5-dimension scorecard with a weighted total + a confidence set by the researcher's evidence quality; (2) name the single biggest panelist-vs-panelist disagreement and how it resolved (or record it as unresolved dissent); (3) emit exactly ONE verdict token — KILL / PIVOT / PERSEVERE / SCALE — checked against the pre-registered thresholds, using champions-or-veto, NOT averaging; (4) state the #1 cause of death with a falsifiable kill-criterion (metric + threshold + date) and the cheapest test to run this week; (5) close with THE single highest-leverage change (the bottleneck) + a deadline — a multi-item to-do list as the close is forbidden.`,
  { label: 'chair', phase: 'Verdict' })

return { round1, round2, chair }
```

**Args robustness:** if your runtime doesn't reliably propagate `args` into a backgrounded workflow,
interpolate `BRIEF`/`TOPIC` into the script as string literals when you author it (the orchestrator
writes them in directly) instead of relying on `args.brief`/`args.topic`. Either way, also tell each
agent it may read the repo/memory itself — grounding should never depend solely on the passed brief.

(No ultracode? Do the same three phases with parallel `Task`/Agent calls: 5 critiques → feed each the
other four's output for one cross-fire reply → one Chair agent synthesizes. The phases are the point,
not the tool.)

### Phase 2 — Cross-fire (do not skip — this is what makes it a panel)

Each panelist sees its OWN round-1 take plus the other four, then answers the challenges aimed at it.
Force structure so it can't melt into five reaction monologues: for ≥2 specific named claims, each
panelist emits `CLAIM → CONCEDE | REBUT | REFRAME → evidence`, conceding **only on disconfirming
evidence**, never on another's confidence. Burying panelist-vs-panelist disagreement produces false
consensus — the single most common way these reviews become worthless.

### Phase 3 — Chair synthesis → the document

The Chair (you, or the chair agent) writes the final document below. **One verdict. One bottleneck.**

## The five lenses (inline roster — self-contained fallback)

Full definitions live in `agents/<name>.md`; this is the essence if the subagents aren't installed.
Each panelist writes in the project's working language (this user → **繁體中文**), keeps
identifiers/numbers verbatim, anchors every claim in the actual artifact, and ends with a **self-score
/5 + Cross-fire challenges to others by name**.

- **🚀 expander — growth strategist.** "What's the largest defensible value this could become, and the
  cheapest next step?" JTBD job-map · ONE North Star · growth loops > funnels · land-and-expand
  monetization ladder · RICE under the real budget. Output: a Now/Next/Later expansion ladder + a
  mandatory **Won't-build** list. Never a feature wishlist.
- **⚛️ first-principles — the deconstructor.** Boils to invariants vs assumptions; runs Musk's ordered
  algorithm (question requirement → **delete** → simplify → accelerate → automate) + the idiot index.
  Output: a ranked **BUILD** list and **CUT** list, and the one thing to keep at 1/10th scope. A
  decision, never a teardown.
- **🔎 researcher — the evidence forager.** Triangulates ≥3 independent primary sources; dual market
  sizing; competitor matrix; Steam/Boxleiter bands; never ships an unattributed number. Output: cited
  evidence brief + explicit **Unknowns**. Sets the panel's confidence.
- **🗡️ critic — red-team / inversion.** Steelman first → base rate → invert → pre-mortem → ONE cause of
  death ranked by severity × probability → a **falsifiable kill-criterion** (metric + threshold + date)
  + the cheapest disproving test. Not a cheerleader, not a reflexive naysayer; concedes only on evidence.
- **🙍 user-advocate — the skeptical buyer.** ONE named persona with a budget and an incumbent; narrates
  the first-session timeline; JTBD four forces + 9x rule; names a price (Van Westendorp anchors); ends
  with **BUY / WISHLIST / SKIP / REFUND** + the one reason. Buyer-mode, never UX platitudes.

## The Incubator Roast document (final output template)

Emit clean markdown. Keep section anchors in English; content in the user's language.

```markdown
# 🔥 Incubator Roast: <subject / 議題>

> Verdict: <KILL | PIVOT | PERSEVERE | SCALE> · Confidence: <N%>
> Subject: <project / topic> · Stage: <idea | MVP | launching> · Panel: 🚀⚛️🔎🗡️🙍

## The bar (pre-registered)
- Scorecard dimensions + stage weights · Kill/scale thresholds (stated BEFORE the critique)

## Scorecard
| Dimension | Score /5 | Evidence anchor (cite the artifact) | Owner |
|-----------|----------|--------------------------------------|-------|
| Problem & desirability | n | … | user-advocate / expander |
| Differentiation & moat | n | … | critic / researcher |
| Expansion upside | n | … | expander |
| Focus & feasibility | n | … | first-principles |
| De-risk / survival | n | … | critic |
> Weighted total: n/5 · Confidence: <N%> (set by evidence quality)

## The panel (each lens, its sharpest point in 2-3 lines)
- 🚀 Expander: …
- ⚛️ First-principles: …
- 🔎 Researcher: … (with the 2-3 facts that most move the decision + key Unknowns)
- 🗡️ Critic: …
- 🙍 User: <persona> → <BUY/WISHLIST/SKIP/REFUND>, because …

## Cross-fire (disagreements, by name)
- <panelist> vs <panelist>: <the clash> → <resolved how / UNRESOLVED dissent recorded>

## The fatal flaw & kill-criterion
- #1 cause of death: … (severity × probability)
- Disproven if: <metric + threshold + date>. Cheapest test this week: <experiment>.

## Verdict & the ONE thing
- Rationale: why the Verdict in the header follows the pre-registered threshold (don't restate the token).
- Champion / veto: <who carried it; recorded dissent>.
- 🔑 THE bottleneck (do this first): <single highest-leverage change> — by <deadline>.

## First action (this week)
- <the one concrete, cheap next move — runnable, not a wishlist>
```

## Common failure modes (what makes a panel worthless)

| Failure | Fix |
|---|---|
| Politeness / compliment theater | Compliments are "the fool's gold of customer learning". Every harsh line carries an evidence reason; praise that isn't load-bearing is cut. |
| Groupthink / anchoring | Each lens scores independently *before* cross-talk. Instant unanimity is a red flag to probe, not a success. |
| No decision ("interesting, keep going") | Banned terminal states. Emit exactly one of KILL/PIVOT/PERSEVERE/SCALE + confidence. |
| Cross-examining only the founder | Mandate the cross-fire round — panelists challenge each other by name. This is the most-skipped, highest-value step. |
| Verdict with no single action | Name THE one bottleneck (YC style). A ten-item to-do list as the close is forbidden. |
| Moving the goalposts | Pre-register kill/scale thresholds at the open; check the close mechanically against them. |
| Generic, ungrounded feedback | Every critique must quote a specific element of THIS project. Feedback that could apply to any company helps none. |
| Showmanship over substance | Brutal tone is allowed, but it must resolve into an actionable, defensible verdict — roast in service of a decision, not entertainment. |

## Before you send — final gate

1. **One verdict token** (KILL/PIVOT/PERSEVERE/SCALE) + confidence, checked against the pre-registered bar.
2. **The cross-fire actually happened** — at least one named panelist-vs-panelist clash is recorded.
3. **A falsifiable kill-criterion** exists (metric + threshold + date) with a cheap test.
4. **Exactly ONE bottleneck** as the close — not a to-do list.
5. **Every score has an evidence anchor** tied to the real artifact, not adjectives.
