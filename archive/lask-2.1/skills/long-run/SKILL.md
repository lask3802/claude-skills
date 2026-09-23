---
name: long-run
description: Use when a task will take many steps or a long unattended run — a migration, a multi-file refactor, a port, "let it run", 跑到完, 長任務 — or must survive context compaction. Sets the finish line and stop conditions, keeps the checklist in TASKS.md, and ends with a Blocked-on-me report. Not for tasks under about five steps.
---

# Long run

A long run fails in three ways: it never knew where the finish line was, it stops to ask
when nothing needed asking, or it loses its place when older turns are summarized. This
skill closes all three with one file and one report shape.

## 1. Fix the contract before the first edit

Three lines, written at the top of `TASKS.md` in the repository root:

```
Done means: <checkable conditions: "cargo test passes on the whole workspace", "no call
            site imports legacy_db any more", "every row in inventory.tsv is done">
Stop and ask only if: <what genuinely needs the owner: a failure you cannot explain, a
            destructive step, a spec gap that changes the work>
Out of scope: <what stays untouched>
```

Take them from the user's message. If the finish line is missing, derive the strictest
reasonable one, write it, and say it in one line — ask only when two readings would lead to
different work. A finish line must be something a command or a file can show, not
"looks good".

## 2. The checklist is the state

```
## Checklist
- [ ] <unit of work, small enough to finish and verify in one sitting>
## Found along the way
## Blocked on owner
## Log
```

- Tick an item the moment it is verified, with the evidence in a few words
  (`- [x] crates/inventory ported — cargo test -p inventory: 41 pass`).
- New work discovered mid-run becomes a new item, not a detour.
- An item that needs the owner moves to `Blocked on owner` with the exact question; keep
  working on everything that does not depend on it.
- A message the user types mid-run is folded into the checklist before you act on it.
- After a context compaction, re-read `TASKS.md` before the next action. The lask
  SessionStart hook reminds you when the file has open items and a `Done means:` line (it
  looks in the working directory and up to the repository root). The summary is a
  convenience; the file is the truth.
- Do not commit `TASKS.md` unless the repository already tracks such files.

## 3. Keep going

- A status note goes in the same message as the next tool call. Never end a turn with a
  summary that names a step you could take, an offer to continue, or a list of
  non-blocking options.
- Stop only for the conditions in the contract, or before anything destructive or outside
  the repository. The lask guard hook puts a permission prompt in front of destructive shell
  commands (in headless runs they are denied); do not route around it.
- Many independent units (every service, every endpoint, every row): use `lask:fan-out`.
  A unit that must match an external spec: land it through `lask:review-loop`.

## 4. Finish

1. Run every `Done means` condition as a command and read the output. A condition not
   executed is not met.
2. Code changed: one isolated review pass on the whole diff (`lask:reviewer`; for
   spec-bound changes the full `lask:review-loop`). Fix confirmed blockers, re-run step 1.
3. Final message, three headings in this order:

```
## Blocked on me
<each decision or approval the owner owes, with the question and the options; "nothing">
## Changed
<what changed, grouped by area, with path:line anchors; the verification commands and results>
## Found
<surprises, pre-existing bugs, things deliberately left alone, anything you could not confirm>
```

`Blocked on me` comes first because it is the only part the owner must act on.
