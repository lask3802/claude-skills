---
name: design-brief
description: Use when building or restyling anything visual where Claude picks the look — a page, an app screen, an artifact, a slide, a component, a landing page. Applies the user's accumulated list of design patterns to leave out as hard constraints, names the choices made instead, and grows the list when the user rejects a default. Not for pure logic or backend work.
---

# Design brief

With no direction, a model falls back on a handful of house styles, and "avoid a generic
look" only swaps one house style for another. What works is a concrete list of patterns to
leave out, grown every time a result shows a default the user does not want.

## 1. Load the avoid list

Read, when present, and treat every line as a hard constraint:

1. `~/.claude/lask/design-avoid.md` — user-wide (under `$CLAUDE_CONFIG_DIR` instead of
   `~/.claude` when that variable is set).
2. `.claude/design-avoid.md` in the repository — project-specific; wins on conflict.

If the user-wide file is missing, create it by copying the seed `templates/design-avoid.md`
from the lask plugin (two directories above this skill's base directory) and say so in one
line. This list is maintained for the user at their request, so creating and appending to it
is not a change that needs a stop. (The user can also seed it with `/lask:doctor --install`.)

Add the patterns named in the request itself. Positive direction from the user (brand
colors, a reference site, a design system) comes first; the avoid list constrains what is
left open.

## 2. Build

Build the finished thing, not an outline or a mood board. When another skill governs the
medium (artifact design, slides), follow it too; the avoid list is additive and wins where
the two disagree.

Before delivering, check the result against every line of the list — a background color
set by a framework default counts as your choice.

## 3. Name what you chose instead

After the result, three or four bullets: background and palette, type pairing, layout
pattern, component style. These are the defaults the user is most likely to veto, so make
them easy to veto.

## 4. Grow the list

When the user rejects something ("no gradients", "not these rounded cards"):

1. Append a specific line to the list: project-specific taste to the repository file,
   otherwise to the user-wide file. Phrase it as a pattern ("Purple-to-blue gradient
   hero backgrounds"), not a judgment ("ugly hero").
2. Rebuild with the grown list.

Never delete lines on your own; the user curates the list.
