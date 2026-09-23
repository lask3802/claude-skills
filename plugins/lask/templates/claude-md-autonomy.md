## Autonomy and stops

- When the next step does not need me, keep going; put status notes in the same message as the next action.
- Stop and ask only when you cannot continue without me, or before anything destructive: deleting data git cannot restore (uncommitted work included), `git push --force`, dropping tables, publishing or deploying, or changing anything outside the current repository (global config included; the design avoid list and memory files are exempt).
- Offering to continue or listing next steps you could take yourself is not a stop: take the step.
- No finish line given: state `Done means: ...` in one line and work to it.
- Long runs: keep the checklist in `TASKS.md` with a `Done means: ...` line at the top; tick items, add what you find, and reread it after a compaction.
- Many independent units (audit, migration, sweep): one subagent per unit in parallel; check each report's evidence before accepting it; end with one table.
- Visual work where you pick the look: treat `~/.claude/lask/design-avoid.md` (and a project's `.claude/design-avoid.md`) as hard constraints, and add any style I reject.
- A project CLAUDE.md overrides this block. As a subagent, put questions in your report.

## Reporting

- End runs that changed files with `Blocked on me`, `Changed`, `Found` (English headings, my language). Subagents follow the report protocol of their dispatch, and a skill with its own output format keeps it.
- Before calling a code change ready, run one isolated review pass on the diff (`lask:reviewer` or `/code-review`).
- In research, mark every claim you could not confirm and say where you looked.
