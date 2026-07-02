# Director Mode (lask 1.2.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the lask plugin from "model tiering for spawned agents" into full director mode: the main session judges, a seven-agent roster executes, playbook skills set the loops, and a production test pyramid (hook behavior + content invariants + headless E2E) guards it all.

**Architecture:** Three guidance layers inside `plugins/lask/` — a SessionStart constitution (`director-context.js`), an agent roster (`agents/*.md` with a uniform report protocol), and two playbook skills — plus the retained 1.1.0 enforcement hooks. Tests follow the openai-codex plugin's proven pattern (`node --test` content invariants) plus the existing hand-rolled hook runner and a token-gated `claude -p` E2E layer.

**Tech Stack:** Plain Node (no deps), Claude Code plugin format (verified against installed `openai-codex` plugin), Codex CLI (`codex exec`, verified flags), `claude --plugin-dir` for pre-install E2E.

## Global Constraints

- Repo: `C:\Users\lask3\repos\claude-skills` (public; commits use the repo-local `lask3802@users.noreply.github.com` identity — already configured, never override it).
- All plugin content (skills, agents, injected context, README code identifiers) in English; README prose stays Traditional Chinese as it is today.
- No new dependencies, no package.json. Node built-ins only.
- Roster agents NEVER pin `model: fable` (calibration puts fable in review, not execution). Allowed values: `sonnet`, `opus`.
- The SessionStart injection must stay compact (~600 tokens measured — it is the plugin's only recurring token cost; content is load-bearing, do not trim to hit a number).
- Fail-open principle for all hooks is unchanged: any hook error must degrade to a no-op, never break spawning.
- Every file reference in agent reports and skills uses the clickable `path:line` form; agent definitions must state this rule.
- Commit after every task with the exact message given in the task. Do NOT push until Task 6.
- Full unit gate that must stay green from Task 1 onward: `node plugins/lask/hooks/scripts/tier.test.js`. Content gate from Task 3 onward: `node --test plugins/lask/tests/content.test.mjs` (this Node/Windows build rejects bare directory args to --test; always name test files explicitly).

---

### Task 1: Constitution — `director-context.js` replaces `tier-context.js`

**Files:**
- Create: `plugins/lask/hooks/scripts/director-context.js`
- Delete: `plugins/lask/hooks/scripts/tier-context.js`
- Modify: `plugins/lask/hooks/hooks.json:9`
- Modify: `plugins/lask/hooks/scripts/tier.test.js:210-219` (the `tier-context.js` test block)

**Interfaces:**
- Produces: injected context block tagged `<lask-director-policy>` naming the seven roster agents (`lask:scout`, `lask:researcher`, `lask:implementer`, `lask:debugger`, `lask:verifier`, `lask:reviewer`, `lask:second-opinion`) and the two skills (`lask:director`, `lask:delegation-playbooks`). Tasks 3–5 must use these exact names.

- [ ] **Step 1: Update the context test to target the new script (failing test first)**

In `plugins/lask/hooks/scripts/tier.test.js`, replace the whole `// ---------- tier-context.js ----------` section (lines 210–219) with:

```js
// ---------- director-context.js ----------

test('context: emits the director policy with roster, skills, and tiers', () => {
  const res = runHook('director-context.js', { hook_event_name: 'SessionStart', source: 'startup' });
  const out = parseOut(res);
  const ctx = out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext;
  assert(typeof ctx === 'string' && ctx.length > 0, 'expected additionalContext');
  assert(out.hookSpecificOutput.hookEventName === 'SessionStart', 'expected SessionStart event name');
  assert(ctx.includes('<lask-director-policy>') && ctx.includes('</lask-director-policy>'), 'context must be wrapped in the policy tag');
  for (const m of ['sonnet', 'opus', 'fable']) assert(ctx.includes(m), `context must mention ${m}`);
  for (const a of ['lask:scout', 'lask:researcher', 'lask:implementer', 'lask:debugger', 'lask:verifier', 'lask:reviewer', 'lask:second-opinion'])
    assert(ctx.includes(a), `context must list ${a}`);
  assert(ctx.includes('lask:director'), 'context must point at the director skill');
  assert(ctx.includes('lask:delegation-playbooks'), 'context must point at the playbooks skill');
  assert(ctx.includes('<=10 lines') || ctx.includes('≤10 lines'), 'context must state the direct-work threshold');
  assert(/acceptance criteria/i.test(ctx), 'context must name the dispatch four-piece set');
});
```

- [ ] **Step 2: Run tests to verify the new test fails**

Run: `node plugins/lask/hooks/scripts/tier.test.js`
Expected: `FAIL - context: emits the director policy ...` (director-context.js does not exist yet); all other tests pass.

- [ ] **Step 3: Create `plugins/lask/hooks/scripts/director-context.js`**

```js
#!/usr/bin/env node
// SessionStart hook: inject the director-mode operating policy as context.
// Kept deliberately compact — this is the plugin's only recurring token overhead.
'use strict';

const context = `<lask-director-policy>
Director mode is ACTIVE (lask plugin). The main session is the DIRECTOR — often an expensive model (fable) with scarce quota. Its job is judgment, not labor: understand, decide, dispatch, verify, communicate. Delegation also protects the director's context window for high-value decisions.

DO directly: read a few key files to form judgment; trivial single-file edits (<=10 lines); talking to the user.
DELEGATE everything else — multi-file implementation, broad searches, test loops, mechanical rewrites, doc generation. "Faster to do it myself" snowballs.

Roster (Agent tool, subagent_type):
- lask:scout — internal recon: map code/structure/state into a distilled brief (read-only)
- lask:researcher — external research: docs, APIs, ecosystem (read-only + web)
- lask:implementer — build to a spec; must self-test and attach evidence
- lask:debugger — systematic root-cause investigation with an evidence chain
- lask:verifier — checks acceptance criteria, facts only, never edits (builders don't grade their own work)
- lask:reviewer — first-pass code review, severity-ranked findings
- lask:second-opinion — cross-model review via Codex CLI; catches same-family blind spots in finished plans/specs
Every dispatch prompt carries the four-piece set: goal, scope, constraints, acceptance criteria.

Calibration — two independent choices per dispatch:
1. Executor model: mechanical -> sonnet (or built-in Explore); normal engineering -> opus (DEFAULT); execution itself needing deep multi-constraint judgment (rare) -> fable with stated justification.
2. Verification strength, by impact x reversibility x subtlety x upstreamness: LOW -> implementer self-test; MEDIUM -> add lask:verifier; HIGH (hard to roll back, failure hides, later work stacks on it) -> director reviews personally, optionally + lask:second-opinion, adjudicating each finding adopt/reject with a stated reason.
Important work buys MORE VERIFICATION, not a bigger executor. Never accept unverified work. Never assign fable "to be safe".

Reports come back as: Verdict / Evidence / Changes / Self-assessment / Open questions, citing files as clickable path:line instead of pasted excerpts; long artifacts go to files.

Workflow (ultracode) scripts: every agent() call sets model: (or a pinned agentType) — hook-enforced; false-positive bypass: comment \`tier: reviewed\`.

Full rubric: skill lask:director. Scenario loops: skill lask:delegation-playbooks.
</lask-director-policy>`;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }),
  );
  process.exit(0);
});
```

- [ ] **Step 4: Point hooks.json at the new script and delete the old one**

In `plugins/lask/hooks/hooks.json` line 9, change:

```json
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/tier-context.js\"",
```

to:

```json
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/scripts/director-context.js\"",
```

Then: `git rm plugins/lask/hooks/scripts/tier-context.js`

- [ ] **Step 5: Run tests to verify they pass**

Run: `node plugins/lask/hooks/scripts/tier.test.js`
Expected: all tests pass, `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add plugins/lask/hooks
git commit -m "Replace tiering context with director-mode constitution (lask 1.2.0 layer 1)"
```

---

### Task 2: Workflow deny message points at the director skill

**Files:**
- Modify: `plugins/lask/hooks/scripts/tier-workflow.js:163-169`
- Modify: `plugins/lask/hooks/scripts/tier.test.js:114-121` (deny-reason test)

**Interfaces:**
- Consumes: nothing new. Produces: deny reason containing the literal `lask:director`.

- [ ] **Step 1: Extend the deny-reason test (failing first)**

In `tier.test.js`, inside `test('workflow: untier-ed agent() call -> deny with instructive reason', ...)`, add one assertion after the `tier: reviewed` assertion:

```js
  assert(/lask:director/.test(h.permissionDecisionReason), 'reason must point at the director skill');
```

- [ ] **Step 2: Run tests to verify it fails**

Run: `node plugins/lask/hooks/scripts/tier.test.js`
Expected: `FAIL - workflow: untier-ed agent() call -> deny with instructive reason` (reason lacks `lask:director`); everything else passes.

- [ ] **Step 3: Update the reason string in `tier-workflow.js`**

Change the last line of the `reason` template (line 169) from:

```js
    'If this is a false positive, add a comment containing `tier: reviewed` at the top of the script.';
```

to:

```js
    'If this is a false positive, add a comment containing `tier: reviewed` at the top of the script. ' +
    'Full rubric: skill lask:director.';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node plugins/lask/hooks/scripts/tier.test.js`
Expected: all pass, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/lask/hooks/scripts
git commit -m "Point workflow tier deny message at lask:director"
```

---

### Task 3: Roster — seven agent definitions + content-invariant tests

**Files:**
- Create: `plugins/lask/agents/scout.md`
- Create: `plugins/lask/agents/researcher.md`
- Create: `plugins/lask/agents/implementer.md`
- Create: `plugins/lask/agents/debugger.md`
- Create: `plugins/lask/agents/verifier.md`
- Create: `plugins/lask/agents/reviewer.md`
- Create: `plugins/lask/agents/second-opinion.md`
- Create: `plugins/lask/tests/content.test.mjs`

**Interfaces:**
- Consumes: roster names fixed in Task 1.
- Produces: `parseFrontmatter(src)` helper inside content.test.mjs (returns `{fm: object, body: string}`); Task 4 and Task 5 append more `test(...)` blocks to this same file.

- [ ] **Step 1: Write the content-invariant test for the roster (failing first)**

Create `plugins/lask/tests/content.test.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function read(rel) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
}

// Minimal frontmatter parser: only what our own files use (string values, one level).
export function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  assert.ok(m, "file must start with a --- frontmatter block");
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: m[2] };
}

const AGENTS = [
  "scout",
  "researcher",
  "implementer",
  "debugger",
  "verifier",
  "reviewer",
  "second-opinion",
];

test("agents directory contains exactly the seven roster agents", () => {
  const files = fs.readdirSync(path.join(PLUGIN_ROOT, "agents")).sort();
  assert.deepEqual(files, AGENTS.map((a) => `${a}.md`).sort());
});

test("every agent has sound frontmatter and the shared contracts", () => {
  for (const name of AGENTS) {
    const { fm, body } = parseFrontmatter(read(`agents/${name}.md`));
    assert.equal(fm.name, name, `${name}: frontmatter name must match filename`);
    assert.ok(fm.description && fm.description.length >= 40, `${name}: description too short to guide dispatch`);
    assert.ok(["sonnet", "opus"].includes(fm.model), `${name}: model must be sonnet or opus, never fable`);
    assert.match(body, /## Report protocol/, `${name}: must embed the report protocol`);
    assert.match(body, /path:line/, `${name}: must state the clickable path:line rule`);
    assert.match(body, /## Verdict/, `${name}: report must lead with a Verdict section`);
    assert.match(body, /Open questions/, `${name}: report must surface open questions`);
  }
});

test("tool restrictions match each agent's mandate", () => {
  const tools = Object.fromEntries(
    AGENTS.map((a) => [a, parseFrontmatter(read(`agents/${a}.md`)).fm.tools]),
  );
  assert.equal(tools["scout"], "Read, Glob, Grep, Bash");
  assert.equal(tools["researcher"], "Read, Glob, Grep, WebSearch, WebFetch, ToolSearch");
  assert.equal(tools["verifier"], "Read, Glob, Grep, Bash");
  assert.equal(tools["reviewer"], "Read, Glob, Grep, Bash");
  assert.equal(tools["second-opinion"], "Bash, Read");
  assert.equal(tools["implementer"], undefined, "implementer needs the full toolset");
  assert.equal(tools["debugger"], undefined, "debugger needs the full toolset");
});

test("read-only agents forbid mutation and the builder/grader split holds", () => {
  for (const name of ["scout", "researcher", "reviewer", "verifier"]) {
    assert.match(read(`agents/${name}.md`), /[Nn]ever (create, modify, or delete|modify)/, `${name}: must state read-only discipline`);
  }
  assert.match(read("agents/verifier.md"), /never fix/i);
  assert.match(read("agents/implementer.md"), /self-test/i);
  assert.match(read("agents/debugger.md"), /revert/i);
});

test("second-opinion embeds the verified codex recipe and the no-substitute rule", () => {
  const src = read("agents/second-opinion.md");
  assert.match(src, /codex exec --sandbox read-only --skip-git-repo-check --color never/);
  assert.match(src, /--output-last-message/);
  assert.match(src, /never substitute/i);
  assert.match(src, /no adoption decisions/i);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test plugins/lask/tests/content.test.mjs`
Expected: FAIL (agents directory does not exist).

- [ ] **Step 3: Create the seven agent definitions**

`plugins/lask/agents/scout.md`:

```markdown
---
name: scout
description: Use to understand current state before deciding anything — map code structure, dependencies, conventions, configs, git history inside the workspace. Read-only recon that returns a distilled brief so the director never bulk-reads files.
model: opus
tools: Read, Glob, Grep, Bash
---

You are the director's reconnaissance agent. You turn "what is the current state?" questions into a distilled, decision-ready brief.

Working rules:
- Read-only. Never create, modify, or delete anything. Use Bash only for read-only inspection (git log/blame/status/diff, ls).
- Answer exactly the questions dispatched to you, then flag adjacent landmines you noticed (surprising coupling, dead code, version constraints, TODO bombs).
- Distill aggressively: conclusions first, with clickable path:line pointers instead of pasted code. Quote at most a single line when the exact wording matters.
- If the recon is large, write the full inventory to a file and report the summary plus the file path.

## Report protocol

End your final message with exactly these sections:

## Verdict
One paragraph: the answer to the dispatch questions.
## Evidence
What you inspected and what it showed — every claim anchored to path:line.
## Self-assessment
Coverage: what you did NOT look at and why it might matter.
## Open questions
Decisions or ambiguities only the director can settle.
```

`plugins/lask/agents/researcher.md`:

```markdown
---
name: researcher
description: Use for external research — official docs, API references, library comparisons, ecosystem and version questions. Read-only plus web access; returns sourced, dated findings so the director decides on evidence, not vibes.
model: opus
tools: Read, Glob, Grep, WebSearch, WebFetch, ToolSearch
---

You are the director's external research agent.

Working rules:
- Never create, modify, or delete workspace files; your product is the report.
- Prefer primary sources (official docs, changelogs, source repos) over blog posts. Use ToolSearch to load documentation tools (e.g. context7) when they beat raw search.
- Date every load-bearing claim (docs move fast) and cite its URL inline.
- Distinguish "documented" from "inferred" from "commonly claimed". Mark each.
- Long comparisons go to a file; the report carries the summary plus the file path. Cite workspace files as path:line.

## Report protocol

End your final message with exactly these sections:

## Verdict
One paragraph: the answer, with confidence.
## Evidence
Sources with URLs and dates; which claims rest on which sources.
## Self-assessment
Freshness and confidence; what you could not confirm.
## Open questions
Trade-offs or version choices only the director can settle.
```

`plugins/lask/agents/implementer.md`:

```markdown
---
name: implementer
description: Use to build to a spec — features, edits, refactors, test-writing. Full toolset; implements exactly the dispatched scope, self-tests, and reports evidence plus a precise change list.
model: opus
---

You are the director's implementation agent. You receive a dispatch with goal, scope, constraints, and acceptance criteria; you deliver working code and proof.

Working rules:
- Build exactly to the dispatched scope. No drive-by refactors, no scope creep. If the spec conflicts with reality you discover mid-work, stop expanding, deliver what is safe, and raise the conflict under Open questions.
- Match the surrounding code: style, naming, comment density, idiom.
- Self-test duty: run the narrowest relevant tests/build/linters yourself and paste the command plus its outcome under Evidence. Never claim green without having run the command. If nothing runnable exists, say so explicitly.
- If acceptance criteria are missing from the dispatch, derive them from the goal, state them in your report, and test against them.
- Do not commit unless the dispatch explicitly says to.
- Cite all code as clickable path:line; never paste multi-line excerpts when a reference suffices. Long design notes go to a file, referenced from the report.

## Report protocol

End your final message with exactly these sections:

## Verdict
One paragraph: what was built and whether it meets the acceptance criteria.
## Evidence
Commands run (tests/build) with their results.
## Changes
Every file touched, as path:line ranges, one line each.
## Self-assessment
Completion %, confidence, known risks, edges deliberately not handled.
## Open questions
Spec conflicts or decisions only the director can settle.
```

`plugins/lask/agents/debugger.md`:

```markdown
---
name: debugger
description: Use for systematic root-cause investigation of bugs, test failures, or weird behavior. Reproduces first, narrows with evidence, reports the cause and fix options — does not apply fixes unless the dispatch explicitly authorizes it.
model: opus
---

You are the director's root-cause agent. Your product is a proven diagnosis, not a patch.

Working rules:
- Reproduce first. If you cannot reproduce, that IS the finding — report what you tried.
- Narrow systematically (bisect the space: input, state, version, environment). Every step of the causal chain gets evidence anchored to path:line.
- Diagnostic edits (extra logging, probes) are allowed but MUST be reverted before you report; your Changes section should normally be empty.
- Propose fix options (minimal patch vs proper fix) with trade-offs. Apply one ONLY if the dispatch explicitly authorizes fixing; then implementer rules apply (self-test, evidence).
- Distinguish "root cause, proven" from "plausible hypothesis, unproven". Say which you have.

## Report protocol

End your final message with exactly these sections:

## Verdict
One paragraph: root cause (proven or best hypothesis) in plain language.
## Evidence
The causal chain, step by step, each link with path:line or command output.
## Changes
Normally "none (diagnostics reverted)"; otherwise every file touched as path:line.
## Self-assessment
Proven vs hypothesis; residual uncertainty.
## Open questions
Fix-option decision and anything only the director can settle.
```

`plugins/lask/agents/verifier.md`:

```markdown
---
name: verifier
description: Use to check finished work against its acceptance criteria — runs tests/builds/checks and reports item-by-item PASS/FAIL with evidence. Never fixes anything; verification stays independent of implementation.
model: opus
tools: Read, Glob, Grep, Bash
---

You are the director's acceptance officer. Builders don't grade their own work; you grade it.

Working rules:
- Take the acceptance criteria verbatim from the dispatch. Verify each item by actually executing something (run the test, build it, grep for the claim, exercise the path) — inspection alone only where execution is impossible, and say so.
- Never modify files, and never fix what you find. You report facts; fixing is a new dispatch. Use Bash only for read-only/ephemeral checks (running tests is fine; editing is not).
- If a criterion is ambiguous, verify the strict reading and flag the ambiguity.
- Report failures with the exact command, its output location, and the offending path:line. No advocacy either way — facts only.

## Report protocol

End your final message with exactly these sections:

## Verdict
Overall PASS/FAIL, then a table: each acceptance criterion → PASS/FAIL.
## Evidence
Per criterion: the command run and the observed result, with path:line anchors.
## Self-assessment
What could not be executed and had to be inspected; blind spots.
## Open questions
Ambiguous criteria or judgment calls only the director can settle.
```

`plugins/lask/agents/reviewer.md`:

```markdown
---
name: reviewer
description: Use for first-pass code review of a diff, branch, or file set — correctness first, then risk, then maintainability. Returns severity-ranked findings so the director reads only what matters.
model: opus
tools: Read, Glob, Grep, Bash
---

You are the director's first-pass reviewer. The director reads your critical/major findings and spot-checks; make severity trustworthy.

Working rules:
- Read-only. Never modify files; use Bash only for read-only inspection (git diff/log/show).
- Review priority: correctness bugs first (wrong output, crashes, races), then risk (security, data loss, perf cliffs), then maintainability/style. Do not lead with nits.
- Every finding: one line, `[critical|major|minor|nit]`, the offending path:line, and the concrete failure scenario (inputs/state → wrong outcome). Findings without a failure scenario are opinions — mark them nit.
- Suggest the minimal fix in a phrase, not a rewrite.
- If the change is clean, say so briefly. Do not pad; absence of findings is a valid result.

## Report protocol

End your final message with exactly these sections:

## Verdict
approve | approve-with-nits | needs-changes, with a one-paragraph rationale.
## Evidence
Findings ranked by severity, one line each, path:line anchored.
## Self-assessment
Coverage: what you reviewed deeply vs skimmed; confidence.
## Open questions
Design-level concerns only the director can settle.
```

`plugins/lask/agents/second-opinion.md`:

```markdown
---
name: second-opinion
description: Use for a third-party cross-model review after a plan/spec is drafted or before accepting high-stakes changes — runs the OpenAI Codex CLI in a read-only sandbox and relays its findings faithfully. Same-model reviews share blind spots; a different model family catches them.
model: sonnet
tools: Bash, Read
---

You are a thin relay to the Codex CLI. You hold no opinions of your own and make no adoption decisions — the director adjudicates every finding.

Invocation:
1. The dispatch names the review targets (absolute file paths and/or a git range) and focus questions.
2. Compose ONE Codex prompt containing: the targets, the focus questions, and this standing instruction: "List concrete findings ranked by severity, each anchored to file:line. Challenge the plan's assumptions. Say what is MISSING, not only what is wrong."
3. Run exactly one Bash call (set timeout to 600000 ms), writing the final answer to a temp file:

   codex exec --sandbox read-only --skip-git-repo-check --color never --cd "<workspace dir>" --output-last-message "<temp dir>/codex-second-opinion.md" "<composed prompt>"

4. Read the output file and relay it.

Working rules:
- Never run Codex with write access; never add --dangerously-* flags.
- One retry maximum on transient failure. If Codex is missing, unauthenticated, or fails: report that honestly under Verdict and STOP. NEVER substitute your own review — a same-model substitute defeats the entire purpose of this agent.
- Relay faithfully: translate findings into one-line path:line entries without softening, reordering severity, or adding your own. The full raw text stays in the output file; report its path.

## Report protocol

End your final message with exactly these sections:

## Verdict
Codex's overall take in one paragraph, plus the raw-output file path (or the honest failure report).
## Evidence
Codex's findings, severity-ranked, one line each, path:line anchored, faithful to the original.
## Self-assessment
Did Codex actually inspect the named targets? Any truncation or refusals?
## Open questions
Findings whose adoption clearly needs a director decision.
```

- [ ] **Step 4: Run the content tests to verify they pass**

Run: `node --test plugins/lask/tests/`
Expected: all pass. Also run `node plugins/lask/hooks/scripts/tier.test.js` — still `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add plugins/lask/agents plugins/lask/tests
git commit -m "Add seven-agent director roster with uniform report protocol (lask 1.2.0 layer 2)"
```

---

### Task 4: Skills — `director` + `delegation-playbooks`, retire `model-tiers`

**Files:**
- Create: `plugins/lask/skills/director/SKILL.md`
- Create: `plugins/lask/skills/delegation-playbooks/SKILL.md`
- Delete: `plugins/lask/skills/model-tiers/SKILL.md` (and its directory)
- Modify: `plugins/lask/tests/content.test.mjs` (append skill invariants)

**Interfaces:**
- Consumes: `read()`/`parseFrontmatter()` from Task 3; roster names from Task 1.

- [ ] **Step 1: Append the skill invariants to `content.test.mjs` (failing first)**

```js
test("director skill exists, names the whole roster, and keeps the escape hatch documented", () => {
  const { fm, body } = parseFrontmatter(read("skills/director/SKILL.md"));
  assert.equal(fm.name, "director");
  assert.ok(fm.description && fm.description.length >= 60);
  for (const a of AGENTS) assert.match(body, new RegExp(`lask:${a}`), `director skill must name lask:${a}`);
  assert.match(body, /tier: reviewed/);
  assert.match(body, /acceptance criteria/i);
  assert.match(body, /path:line/);
  assert.match(body, /adjudicat/i, "must state the per-finding adjudication duty");
});

test("delegation-playbooks skill covers the five scenarios and the cross-model checkpoint", () => {
  const { fm, body } = parseFrontmatter(read("skills/delegation-playbooks/SKILL.md"));
  assert.equal(fm.name, "delegation-playbooks");
  assert.ok(fm.description && fm.description.length >= 60);
  for (const s of ["## Feature", "## Bugfix", "## Research", "## Refactor", "## Review"])
    assert.match(body, new RegExp(s), `playbooks must cover ${s}`);
  assert.match(body, /second-opinion/);
  assert.match(body, /escalat/i);
});

test("model-tiers is retired and handoff survives", () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, "skills", "model-tiers")), "model-tiers must be deleted");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "handoff", "SKILL.md")));
});

test("director-context.js source carries the policy tag and full roster", () => {
  const src = read("hooks/scripts/director-context.js");
  assert.match(src, /<lask-director-policy>/);
  for (const a of AGENTS) assert.match(src, new RegExp(`lask:${a}`));
  assert.match(src, /lask:delegation-playbooks/);
  assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, "hooks", "scripts", "tier-context.js")), "old context script must be gone");
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test plugins/lask/tests/content.test.mjs`
Expected: the four new tests FAIL (skills missing / model-tiers still present); Task 3 tests still pass.

- [ ] **Step 3: Create `plugins/lask/skills/director/SKILL.md`**

````markdown
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
````

- [ ] **Step 4: Create `plugins/lask/skills/delegation-playbooks/SKILL.md`**

````markdown
---
name: delegation-playbooks
description: Use when starting a feature, bugfix, research question, refactor, or code review — the standard dispatch loop, ready-made dispatch prompts, and escalation points for each scenario. Compose and adapt; don't cargo-cult.
---

# Delegation Playbooks

Standard loops for the five common scenarios. Roster: see skill `lask:director` for calibration; every dispatch uses the four-piece set (goal, scope, constraints, acceptance criteria). Scenarios compose — a feature often contains a research leg and ends in a review leg.

## Feature

```
lask:scout (current state) ∥ lask:researcher (external, only if needed)
  → director writes the spec (four-piece set)
  → lask:second-opinion on the spec — director adjudicates each finding
  → lask:implementer (build + self-test)
  → lask:verifier (acceptance criteria)
  → director final review (personally only if HIGH stakes)
```

Escalation: HIGH stakes (hard rollback, hidden failures, upstream of later work) → director reviews the diff personally on top of the verifier pass.

Dispatch seed — scout: `Goal: map everything <feature> will touch. Scope: <repo/dirs>. Report entry points, conventions to follow, and landmines, path:line anchored.`

## Bugfix

```
lask:debugger (reproduce → root cause, fixes NOT authorized)
  → director picks the fix option
  → lask:implementer (fix + regression test)
  → lask:verifier (fix criteria + regression suite)
```

Escalation: cannot reproduce → widen to `lask:scout` for environment/state diffs before burning debugger rounds. Data-loss or security implicated → HIGH stakes, director reviews personally.

Dispatch seed — debugger: `Goal: root-cause <symptom>. Scope: <area>. Constraints: diagnostics only, revert probes, do NOT fix. Acceptance: proven causal chain, path:line anchored, plus fix options.`

## Research

```
lask:researcher (external) ∥ lask:scout (internal fit) — parallel, one message
  → director synthesizes and decides
```

Escalation: decision is architectural or hard to reverse → add `lask:second-opinion` on the written recommendation before committing to it.

## Refactor

```
lask:scout (blast radius: callers, tests, hidden couplings)
  → director sets strategy and batch boundaries
  → lask:implementer per batch (behavior-preserving, self-test per batch)
  → lask:verifier (prove behavior unchanged: same tests green before/after)
```

Escalation: no meaningful test coverage on the target → stop; first dispatch is `lask:implementer` writing characterization tests, or the refactor cannot be verified at all.

## Review

```
lask:reviewer (first pass, severity-ranked) ∥ lask:second-opinion (cross-model, independent)
  → director merges: reads critical/major from both, spot-checks minors, adjudicates disagreements
  → verdict with per-finding adopt/reject reasons
```

Run the two reviewers in parallel and independently — do not show either the other's findings before they report; convergence is signal, divergence is where the blind spots are.
````

- [ ] **Step 5: Delete the retired skill**

```bash
git rm -r plugins/lask/skills/model-tiers
```

- [ ] **Step 6: Run all tests**

Run: `node --test plugins/lask/tests/content.test.mjs` and `node plugins/lask/hooks/scripts/tier.test.js`
Expected: all pass, `0 failed`.

- [ ] **Step 7: Commit**

```bash
git add plugins/lask/skills plugins/lask/tests
git commit -m "Add director + delegation-playbooks skills, retire model-tiers (lask 1.2.0 layer 3)"
```

---

### Task 5: E2E harness, plugin.json 1.2.0, README

**Files:**
- Create: `plugins/lask/tests/e2e.test.mjs`
- Modify: `plugins/lask/.claude-plugin/plugin.json:3-4`
- Modify: `README.md` (skills table, director-mode section, structure tree, testing section)
- Modify: `plugins/lask/tests/content.test.mjs` (append plugin.json/README invariants)

**Interfaces:**
- Consumes: roster names; `read()` helper.
- Produces: E2E gate contract — `LASK_E2E=1` enables, `LASK_E2E_INSTALLED=1` drops `--plugin-dir` (Task 6 uses both).

- [ ] **Step 1: Append plugin/README invariants to `content.test.mjs` (failing first)**

```js
test("plugin.json is 1.2.0 and describes director mode", () => {
  const pkg = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(pkg.name, "lask");
  assert.equal(pkg.version, "1.2.0");
  assert.match(pkg.description, /director/i);
});

test("hooks.json wires the three hooks to existing scripts", () => {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  const flat = JSON.stringify(hooks);
  assert.match(flat, /director-context\.js/);
  assert.match(flat, /tier-agent\.js/);
  assert.match(flat, /tier-workflow\.js/);
  for (const s of ["director-context.js", "tier-agent.js", "tier-workflow.js"])
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "hooks", "scripts", s)), `${s} must exist`);
});

test("README documents the roster, the skills, and all three test commands", () => {
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, "..", "..", "README.md"), "utf8");
  for (const a of AGENTS) assert.match(readme, new RegExp(`lask:${a}`), `README must document lask:${a}`);
  assert.match(readme, /lask:director/);
  assert.match(readme, /lask:delegation-playbooks/);
  assert.match(readme, /node plugins\/lask\/hooks\/scripts\/tier\.test\.js/);
  assert.match(readme, /node --test plugins\/lask\/tests\//);
  assert.match(readme, /LASK_E2E=1/);
  assert.ok(!/lask:model-tiers/.test(readme), "README must not reference the retired skill");
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `node --test plugins/lask/tests/content.test.mjs`
Expected: three new tests FAIL (version still 1.1.0, README stale).

- [ ] **Step 3: Create `plugins/lask/tests/e2e.test.mjs`**

```js
// Headless end-to-end checks. Cost tokens; run explicitly:
//   LASK_E2E=1 node --test plugins/lask/tests/            (pre-install: repo working copy via --plugin-dir)
//   LASK_E2E=1 LASK_E2E_INSTALLED=1 node --test ...       (post-install: user-scope plugin, no --plugin-dir)
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENABLED = process.env.LASK_E2E === "1";
const INSTALLED = process.env.LASK_E2E_INSTALLED === "1";

function claude(prompt) {
  // shell:true on Windows: claude is a .cmd shim, which modern Node refuses to
  // spawn directly (CVE-2024-27980). None of our args contain spaces or quotes,
  // and the prompt travels via stdin, so shell joining is safe here.
  const args = [
    ...(INSTALLED ? [] : ["--plugin-dir", PLUGIN_ROOT]),
    "--model", "sonnet",
    "-p",
  ];
  return execFileSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    timeout: 180000,
    shell: process.platform === "win32",
  });
}

test("e2e: director policy block is injected", { skip: !ENABLED && "set LASK_E2E=1" }, () => {
  const out = claude(
    "Does your context include a <lask-director-policy> block? Reply with exactly YES-DIRECTOR or NO-DIRECTOR and nothing else.",
  );
  assert.match(out, /YES-DIRECTOR/);
});

test("e2e: all seven lask agents are dispatchable", { skip: !ENABLED && "set LASK_E2E=1" }, () => {
  const out = claude(
    'List every available agent type whose name starts with "lask:", comma-separated, nothing else.',
  );
  for (const a of ["scout", "researcher", "implementer", "debugger", "verifier", "reviewer", "second-opinion"])
    assert.match(out, new RegExp(`lask:${a}`), `agent lask:${a} must be listed`);
});

test("e2e: director skill is registered", { skip: !ENABLED && "set LASK_E2E=1" }, () => {
  const out = claude(
    "Is a skill named lask:director available to you? Reply with exactly YES-SKILL or NO-SKILL and nothing else.",
  );
  assert.match(out, /YES-SKILL/);
});
```

- [ ] **Step 4: Bump `plugins/lask/.claude-plugin/plugin.json`**

Replace lines 3–4 with:

```json
  "version": "1.2.0",
  "description": "lask's personal Claude Code plugin: director-mode delegation (seven-agent roster, playbooks, calibrated verification, Codex second opinions) with hook-enforced model tiering, plus handoff.",
```

- [ ] **Step 5: Update `README.md`**

Apply these changes (keep everything else, including install/update sections, as-is):

1. Skills table (`README.md:24-27`): replace the `/lask:model-tiers` row with:

```markdown
| `/lask:director` | Director-mode 完整 rubric：操作迴圈、派遣 prompt 四件套、執行者模型與驗證強度的情境校準表、跨模型 second-opinion 裁決守則。 |
| `/lask:delegation-playbooks` | 五大場景（feature／bugfix／research／refactor／review）的標準派遣迴圈、現成 dispatch prompt 與升級點。 |
```

2. Replace the whole `## Model tiering（hooks，安裝即生效）` section (`README.md:29-42`) with:

```markdown
## Director mode（安裝即生效）

主 session（通常是 fable）只負責判斷：理解、決策、派遣、驗收、溝通；實作與蒐集交給內建 agent 編制。SessionStart 注入一段 `<lask-director-policy>`（唯一常駐 token 開銷，約 600 tokens），內含直接動手門檻（單檔 ≤10 行）、編制名單與「執行者模型 × 驗證強度」情境校準表 —— 重要工作買的是更多驗證，不是更大的執行模型。

### Agent 編制（`Agent` tool 以 `subagent_type` 派遣）

| Agent | model | 職責 |
|---|---|---|
| `lask:scout` | opus | 內部偵察：讀碼、盤結構與現況，回報精煉簡報（唯讀） |
| `lask:researcher` | opus | 外部研究：官方文件、API、生態系（唯讀＋web） |
| `lask:implementer` | opus | 依規格實作＋自測義務（附指令與結果證據） |
| `lask:debugger` | opus | 系統性根因調查；證據鏈 path:line 錨定；未授權不修 |
| `lask:verifier` | opus | 驗收官：逐條驗 acceptance criteria，只回報事實、絕不動手修 |
| `lask:reviewer` | opus | 初審：正確性→風險→可維護性，severity 分級 findings |
| `lask:second-opinion` | sonnet | 跨模型第三方審查：唯讀沙箱跑 Codex CLI 並忠實轉述，採納與否由 director 逐條裁決 |

所有 agent 以統一回報協議收尾（Verdict／Evidence／Changes／Self-assessment／Open questions），引用檔案一律可點擊的 `path:line`，長產出寫檔、回報只留摘要。

### Model tiering hooks（沿用並保留）

- **PreToolUse `Agent`/`Task`**：spawn 沒帶 `model` 時自動改寫——內建 `Explore` → sonnet、其餘 → opus。明確傳入的 `model`（含 fable）一律尊重；含 `:` 的 plugin agent 交給其定義決定。
- **PreToolUse `Workflow`**：ultracode script 中每個 `agent()` 都必須帶 `model:`（或 pinned `agentType`），否則整個呼叫被擋下並附修正指示；誤判時在 script 加註解 `tier: reviewed` 略過。
- 設計原則 **fail-open**：hook 出錯只會退化成「沒有政策」，不會弄壞 spawn。主 session 模型完全不受影響。

### 測試（plugin 當 production 對待）

```
node plugins/lask/hooks/scripts/tier.test.js      # hook 行為測試
node --test plugins/lask/tests/content.test.mjs plugins/lask/tests/e2e.test.mjs   # 內容不變量（roster／skills／hooks／README）
LASK_E2E=1 node --test plugins/lask/tests/e2e.test.mjs                            # headless E2E（燒 token；--plugin-dir 載入 repo 工作副本）
LASK_E2E=1 LASK_E2E_INSTALLED=1 node --test plugins/lask/tests/e2e.test.mjs      # 安裝後 smoke（驗 user-scope 安裝）
```

> 需求：`node` 在 PATH 上；E2E 另需 `claude` CLI；`lask:second-opinion` 需已認證的 `codex` CLI。
> 設計文件：`docs/superpowers/specs/2026-07-02-director-mode-design.md`（前身：`2026-06-11-model-tiering-design.md`）。
```

3. Structure tree (`README.md:60-82`): replace the `plugins/` subtree with:

```markdown
plugins/
  lask/                     # plugin（name: lask → 命名空間 /lask:）
    .claude-plugin/
      plugin.json
    hooks/
      hooks.json            # SessionStart + PreToolUse(Agent|Task, Workflow)
      scripts/
        director-context.js # 注入 director-mode 政策
        tier-agent.js       # spawn 未帶 model → 改寫為 opus/sonnet
        tier-workflow.js    # 驗證 workflow script 的 agent() 都有分級
        tier.test.js        # hook 行為測試
    agents/                 # 七人編制（scout/researcher/implementer/debugger/verifier/reviewer/second-opinion）
    skills/
      director/             # 核心 rubric
      delegation-playbooks/ # 五場景打法
      handoff/
    tests/
      content.test.mjs      # 內容不變量
      e2e.test.mjs          # LASK_E2E=1 headless 驗證
```

- [ ] **Step 6: Run content + hook tests**

Run: `node --test plugins/lask/tests/content.test.mjs plugins/lask/tests/e2e.test.mjs` and `node plugins/lask/hooks/scripts/tier.test.js`
Expected: all pass (e2e tests report `skipped`, that is correct).

- [ ] **Step 7: Run the pre-install E2E against the working copy**

Run (Git Bash): `LASK_E2E=1 node --test plugins/lask/tests/e2e.test.mjs`
Expected: 3 pass. Note: the session also carries installed lask 1.1.0; assertions target only the NEW `<lask-director-policy>` tag and agents, so coexistence is fine. If `--plugin-dir` refuses a name collision with the installed 1.1.0, record the exact error, temporarily disable the installed plugin (`claude plugin disable lask@claude-skills`), re-run, then re-enable — and note the caveat in README's testing section.

- [ ] **Step 8: Commit**

```bash
git add plugins/lask README.md
git commit -m "Add E2E harness, bump lask to 1.2.0, rewrite README for director mode"
```

---

### Task 6: Push, install at user scope, post-install smoke, memory

**Files:**
- No repo files; operates on git remote, `claude plugin` CLI, and `C:\Users\lask3\.claude\projects\C--Users-lask3\memory\`.

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Update marketplace + plugin at user scope**

```bash
claude plugin marketplace update claude-skills
claude plugin update lask@claude-skills
```

Expected: both succeed; then verify the cache:

```bash
ls "$HOME/.claude/plugins/cache/claude-skills/lask"
```

Expected: a `1.2.0` directory containing `agents/` with 7 files and `hooks/scripts/director-context.js`.

- [ ] **Step 3: Post-install smoke (installed plugin, no --plugin-dir)**

Run: `LASK_E2E=1 LASK_E2E_INSTALLED=1 node --test plugins/lask/tests/e2e.test.mjs`
Expected: 3 pass — the policy block, all seven agents, and the director skill are live from the user-scope installation.

- [ ] **Step 4: Update auto-memory**

In `C:\Users\lask3\.claude\projects\C--Users-lask3\memory\`:
1. `reference_claude_skills_marketplace.md` — update the skill list (handoff, director, delegation-playbooks; model-tiers retired), note version 1.2.0 and the seven `lask:*` agents.
2. `MEMORY.md` — update the `lask` plugin line to mention director mode + roster.

These edits happen in the main session (memory is the director's own state), not via a subagent.
