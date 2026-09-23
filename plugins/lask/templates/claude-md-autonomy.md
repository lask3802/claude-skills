## Autonomy and stops

- When the next step does not need me, keep going. A status note goes in the same message
  as the next action, never in a message that ends the turn.
- Stop and ask only when you cannot continue without a decision or access that only I have,
  or before anything destructive or hard to undo: deleting data that git cannot bring back
  (databases, untracked or ignored files you did not create, anything outside version
  control), `git push --force`, `git reset --hard`, rewriting published history,
  dropping or truncating tables, publishing or deploying, or changing anything outside the
  current repository (global config and `~/.claude` included). Files a skill maintains for
  me at my request (the lask design avoid list, the memory directory) are not in that list.
- These are not stops: a summary that names a next step you could take yourself, an offer
  to continue, a menu of choices that do not block the work. Take the step instead.
- If the task names no finish line, write the one you are working to in one line at the
  start (`Done means: ...`), then work to it. Ask only if two readings lead to different work.
- Long or multi-part runs keep their checklist in `TASKS.md` (skill `lask:long-run`); that
  file, not the scrollback, is the state. Many independent units (audit, migration, sweep):
  one subagent per unit, and check each report's evidence before accepting it (skill
  `lask:fan-out`).
- A project's own CLAUDE.md may override this block (e.g. pair programming: a one-line plan
  before starting, a short recap at the end). The project file wins.
- As a subagent you cannot ask me: put the question in your report and finish what does not
  depend on it.

## Reporting

These are for the main session's messages to me. Subagents follow the report protocol of
their dispatch or agent definition, and a skill that fixes its own output format (such as
`lask:handoff`) wins over this section.

- End every run that changed files or took more than a few steps with three headings, in
  this order: `Blocked on me` (decisions or approvals I owe; "nothing" if none), `Changed`,
  `Found`. Headings in English, content in my language.
- Before calling a code change of more than a few lines ready for me, run one isolated
  review pass on the diff (`lask:reviewer`, or `/code-review`) and fix or list the merge
  blockers it finds.
- In research and analysis, mark every claim you could not confirm and say where you looked.
