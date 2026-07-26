#!/usr/bin/env node
// Flip director mode on/off, or report where the current verdict comes from.
// Usage: node director-toggle.js [on|off|reset|status]
//
// Writes the explicit flag files director-state.js reads, so a toggle beats any
// LASK_DIRECTOR value in settings.json ("reset" drops back to that). Enforcement
// (the hands-on edit throttle) reacts immediately; the policy text is injected only
// at SessionStart, so switching ON mid-session lands on the next session or /clear.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { describe, flagPaths } = require('./director-state.js');

const action = (process.argv[2] || 'status').toLowerCase();
const { dir, on, off } = flagPaths();

function rm(p) {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    /* already gone */
  }
}

function touch(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `set by director-toggle at ${new Date().toISOString()}\n`);
}

try {
  if (action === 'on') {
    rm(off);
    touch(on);
  } else if (action === 'off') {
    rm(on);
    touch(off);
  } else if (action === 'reset') {
    rm(on);
    rm(off); // fall back to $LASK_DIRECTOR / the opt-in default
  } else if (action !== 'status') {
    console.error(`unknown action "${action}" (expected on|off|reset|status)`);
    process.exit(2);
  }
} catch (e) {
  console.error(`could not write the flag file under ${dir}: ${e && e.message}`);
  process.exit(1);
}

const s = describe();
console.log(`director mode: ${s.enabled ? 'ON' : 'OFF'}  (source: ${s.source})`);
if (!s.enabled) {
  console.log(
    'Skills, agents and the model-tiering hooks stay available; only the policy injection and the hands-on edit throttle are off.',
  );
}
if (action === 'on') {
  console.log('The policy text is injected at SessionStart — it lands on the next session or after /clear.');
}
