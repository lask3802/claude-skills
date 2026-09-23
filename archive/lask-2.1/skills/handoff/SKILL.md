---
name: handoff
description: >-
  Use when a work session is ending or being paused and the work will continue in a fresh
  session, a different agent, or a teammate — running low on context, before /compact, switching
  machines or tools, or when the user asks to 交接 / hand off / "summarize this session for whoever
  continues". Produces ONE self-contained, copy-ready handoff document (objective, files with line
  numbers, key findings, decisions, state, next steps) emitted as the sole message so it can be
  grabbed with /copy and pasted into the next session. Keywords: handoff, 交接, hand over, context
  transfer, resume, continue in new session, pass to another agent, session summary, before compact.
---

# Handoff

> **OUTPUT RULE (non-negotiable):** Your reply must **begin with the literal characters `# Handoff:`**
> and contain nothing but the handoff document — no lead-in ("Now I'll produce…", "根據…", "好的"), no
> `---` before the title, no ``` fence around the whole thing, no closing remarks. `/copy` copies your
> entire message; any narration corrupts the paste. When in doubt, delete everything before the `#`.

## Overview

Produce a faithful, self-contained handoff so a **fresh session, a different agent, or a teammate
with ZERO access to this conversation** can resume the work with no context loss.

Two principles drive everything below:

1. **Reconstruct, don't reminisce.** Build the handoff from what *actually happened* this session
   (the files you read/edited, commands you ran, the user's messages) — not from a fuzzy end-of-session
   impression. The work done early in a session is what gets forgotten.
2. **The message IS the artifact.** The reader cannot see this chat. `/copy` copies your whole last
   message. So the handoff must be the *entire* message — nothing before it, nothing after it — and
   every reference in it must be self-contained.

This skill biases toward **thoroughness** (the user wants maximum useful detail), but every line must
be load-bearing. Detail, not padding.

## The /copy contract — read this first

`/copy` copies your **entire last assistant message** to the clipboard. The user will then paste it
verbatim into a new session. Therefore:

- **Emit ONLY the handoff document.** No opener ("Here's the handoff…", "I'll summarize now…"), no
  closer ("Let me know if…", "Hope this helps"). Your message's first character is the `#` of the
  title; its last character is the last line of the doc.
- **Do not wrap the whole document in a code fence.** A fence around everything makes the paste land
  as one code block. Emit clean markdown; only fence *real* code/commands *inside* the doc.
- **Self-contained references only.** No "the bug we found above", no "as discussed", no pronouns
  pointing at invisible context. Spell every reference out — the reader has none of this chat.
- **Match the user's working language** for the *content* (this user → 繁體中文), but keep all paths,
  commands, code, identifiers, and error strings verbatim. Keep the **section headers in English**
  (`## Objective`, `## Next steps`, …) as structural anchors, so handoffs stay uniform across models
  and portable to an English-operating agent.

**The first character of your message MUST be `#`.** Nothing may come before the title — not a
lead-in sentence, not a `---`, not a ``` fence, not "好的" / "現在產生交接文件". Nothing may come after
the doc's last line.

❌ WRONG — this contaminates the `/copy` paste:

```text
根據 working memory 重建本次工作，現在產生交接文件。
---
# Handoff: ...
```

✅ RIGHT — message starts at `#`, ends at the doc's last line:

```text
# Handoff: ...
```

**Red flags — if your message starts with ANY of these, delete them before sending:**
a sentence describing what you're about to do ("現在產生交接文件", "Here's the handoff", "根據…") · a
leading `---` separator · a ``` fence wrapping the whole document · "好的" / "Sure" / "I'll follow the
skill". The next reader and `/copy` want the document, not your narration of it.

> If the user also wants the handoff persisted, additionally write it to `HANDOFF.md` — but the chat
> message must still be the clean document so `/copy` works. (See Variants.)

## Step 1 — Reconstruct the session faithfully

Before writing anything, scan back over the *actual* session from the beginning and gather:

- Every file you **read, edited, or created** — with its real path. Re-derive line numbers you cited;
  do not approximate from memory.
- Every **command** you ran and its outcome (build/test/run, git, repro steps).
- The user's **explicit asks, approvals, rejections, and scope decisions**.
- What you **tried that did NOT work** (dead-ends) — these save the next agent from repeating them.

Faithfulness rules (these prevent the most damaging handoff bugs):

- **Never invent or guess** a file path or line number. Cite a `path:line` only when you actually saw
  it; if you're unsure of the line, cite the path alone (or omit it) — never write an approximate
  `path:line`.
- **Tag any factual claim that could be wrong** `[Verified]` (confirmed by reading/running) or
  `[Assumed]` (not yet confirmed) — everywhere it appears, not only under *Key understanding* — and
  for `[Assumed]`, say how to confirm it.
- For anything needed but not precisely known, **give a locate command** instead of guessing — prefer
  `rg -n "<needle>" <root>`, fallback `grep -rn "<needle>" <root>` (e.g. `rg -n "updateStock" src/`).

## Step 2 — Capture everything (checklist)

Copy this checklist into your working notes and tick each item. Omit a section only if it genuinely
does not apply — never emit an empty header, never pad.

```
Handoff capture checklist:
- [ ] Objective        — the user's goal in THEIR words + definition of done
- [ ] Status           — one line: exactly where things stand right now
- [ ] Environment      — repo path, branch, clean/dirty, build/run/test cmds, key services/env vars
- [ ] Work scope       — table of files: path · line(s) · what/why · read|edited|created
- [ ] Done this session— dense log of actions → outcomes
- [ ] Verification      — commands run → pass/fail/not-run; git + runtime state (servers/ports/bg jobs)
- [ ] Key understanding— architecture / conventions / gotchas, each [Verified] or [Assumed]
- [ ] Decisions        — what was chosen and WHY (settled — don't reopen)
- [ ] Dead-ends        — what was tried that failed (don't repeat)
- [ ] Next steps        — prioritized, concrete, each with file:line where possible
- [ ] Open questions    — needs human / more info; what to ask and whom; what it blocks
- [ ] First actions     — runnable boot sequence to reconstruct + verify the starting state
```

## Step 3 — Emit the document (template)

The template below is shown wrapped in a ` ```markdown ` fence **for display only**. When you emit
your handoff, **do not include that outer fence** — start your message at `# Handoff:`. Keep the
*inner* code fences (e.g. the bash block).

```markdown
# Handoff: <concise task title>

> Status: <one line — e.g. "Root cause found; fix NOT yet applied">
> Repo: <path> · Branch: <branch> · Working tree: <clean | dirty: details> · Last commit: <sha/subject>

## Objective
<What we're trying to achieve, in the user's own words. State the definition of done.>

## How to run / verify
- Build: `<cmd>`   Test: `<cmd>`   Run: `<cmd>`
- Services / env: <DB, env vars, ports, external deps>

## Work scope (files)
| File | Line(s) | What it is / why it matters | State |
|------|---------|------------------------------|-------|
| `src/services/inventory.ts` | 58–66 | non-atomic stock decrement (the real bug) | edited |
| `src/utils/retry.ts` | whole file | retry helper added this session | created |
| `src/db/client.ts` | 12 | sets Serializable isolation | read |

## Done this session
- <action → outcome, dense bullets>

## Verification / current state
- Ran: `<cmd>` → <pass / fail / key output>
- Not run: <verification intentionally skipped or blocked — and why>
- Git: <branch; committed / staged / uncommitted / untracked / pushed?> · Runtime: <dev server / ports / bg jobs still up?>

## Key understanding
- [Verified] <fact confirmed by reading/running>
- [Assumed] <inference not yet confirmed> — confirm by <how>

## Decisions & rationale
- <decision> — because <why>. (Settled; don't reopen without new information.)

## Dead-ends (don't repeat)
- <thing tried> → <why it failed>

## Next steps
1. <concrete action> — `path:line`
2. <next> — `path:line`

## Open questions / blockers
- <question> — ask <who/what>; blocks <what>

## First actions for the next agent
\`\`\`bash
cd <repo> && git checkout <branch> && git status   # reconstruct workspace
<command to reproduce/confirm the current state>    # verify you're at the same starting point
\`\`\`
```

## Variants (arguments after `/handoff`)

- `/handoff` — full session handoff, emitted to chat for `/copy`. (Default.)
- `/handoff <focus>` — bias the Work scope / Next steps toward the named area, but still include the
  essential global context (objective, environment, blockers).
- `/handoff --file [path]` — *also* save the document to `HANDOFF.md` (or the given path), when the
  user asks and the environment allows writing. The chat message must still be the clean, copyable
  document.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Conversational preamble/sign-off in the message | Emit ONLY the document. `/copy` grabs the whole message; chatter pollutes the paste. |
| Summarizing from memory/impression | Reconstruct from the actual session — re-scan files read, commands run, user messages. Early-session work is forgotten most. |
| Inventing or approximating paths / line numbers | Cite only what you saw; mark `[Assumed]`; give a `grep -rn …` locate command for unknowns. |
| Vague next steps ("finish the feature") | Concrete + located: an action plus `path:line`. |
| Referencing invisible context ("the bug above", "as we said") | Self-contained: the reader has none of this chat. Spell it out. |
| Empty/padded sections | Omit sections that don't apply; keep every remaining line load-bearing. |
| Wrapping the entire doc in a code fence | Emit clean markdown; fence only real code/commands inside. |

## Example (gold standard, abbreviated)

A correct emitted message looks exactly like this (note: starts at `#`, no preamble, ends at the last line):

```markdown
# Handoff: Fix intermittent 500 on /api/checkout

> Status: Root cause identified; real fix NOT yet applied (only a partial mitigation committed)
> Repo: /home/dev/shopflow · Branch: fix/checkout-500 · Working tree: dirty (uncommitted notes) · Last commit: "wip: add retry helper"

## Objective
User: "the /api/checkout endpoint returns 500 sometimes, fix it." Done = no 500s under concurrent
checkout of the same product; stock never goes negative; out-of-stock returns a clean 4xx.

## How to run / verify
- Test: `npm test`   Run: `npm run dev` (port 3000)
- Services / env: Postgres via `DATABASE_URL` in `.env`

## Work scope (files)
| File | Line(s) | What it is / why it matters | State |
|------|---------|------------------------------|-------|
| `src/services/inventory.ts` | 58–66 | read-then-write stock decrement — the actual race | read |
| `src/db/client.ts` | 12 | isolation set to Serializable (why the race surfaces as a write-conflict) | read |
| `src/utils/retry.ts` | whole file | `retryTransaction()` helper added (mitigation only) | created |

## Verification / current state
- Ran: `npm run dev` + concurrent checkouts → still ~1/5 500 (bug reproduces). `npm test` not run since last edit.
- Git: branch `fix/checkout-500`; 1 commit (`wip: add retry helper`); scratch notes uncommitted.

## Key understanding
- [Verified] The 500 is `PrismaClientKnownRequestError: Transaction failed due to a write conflict`,
  reproducible ~1 in 5 concurrent checkouts of one product.
- [Verified] `updateStock()` reads stock, checks > 0, then sets stock-1 — lost-update race.
- [Assumed] Serializable isolation is not actually required here — confirm before relaxing it.

## Decisions & rationale
- Added a retry helper as a stopgap — because it reduces the error rate, but it does NOT fix the race.
  (Don't tune retry counts instead of fixing the decrement.)

## Next steps
1. Rewrite `updateStock()` to an atomic conditional decrement (`UPDATE … SET stock = stock-1 WHERE
   stock > 0`), check rows affected, return 409 on 0 — `src/services/inventory.ts:58`
2. Add a concurrent-checkout regression test — `test/checkout.test.ts`

## Open questions / blockers
- Stripe charge runs inside the DB transaction (`src/routes/checkout.ts:95`); user marked it
  out-of-scope — confirm whether to address now.

## First actions for the next agent
\`\`\`bash
cd /home/dev/shopflow && git checkout fix/checkout-500 && git status
npm run dev   # then fire concurrent checkouts on one product to see the ~1/5 500
\`\`\`
```

## Before you send — final gate

Re-read your drafted message and confirm every item, or fix it:

1. **The message starts exactly with `# Handoff:`** — no preamble sentence, no `---`, no opening
   ``` fence, no "好的 / 現在…".
2. **Last character ends the doc** — no "希望有幫助 / let me know if…".
3. **Nothing invented** — every path is real; cite a line number only when it's exact. If a path or
   line is uncertain, do NOT write it as `path:line` — mark the claim `[Assumed]` and add an
   `rg -n "<needle>" <root>` (or `grep -rn …`) locate command instead.
4. **Self-contained** — a reader with zero access to this chat could act on it (no "as above", no
   dangling pronouns).

Only then send — `/copy` copies this message verbatim into the next session.
