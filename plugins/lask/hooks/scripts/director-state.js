#!/usr/bin/env node
// Shared on/off gate for director mode, used by director-context.js (policy
// injection) and director-enforce.js (hands-on edit throttle).
//
// Director mode is OPT-IN as of 1.7.0. The 2026-07-25 Opus-5 2x2 benchmark
// measured it as a net negative for solo work on a capable executor: no judge-score
// gain, 1.7-2.5x cost, every delegating run exhausted its wall clock, and three
// required deliverables were lost inside agents that never returned. Model tiering
// (tier-agent/tier-workflow) is NOT gated by this — it is useful either way.
//
// Resolution order, first match wins:
//   1. <state>/director.off  -> OFF  (explicit; written by /lask:director-off)
//   2. <state>/director.on   -> ON   (explicit; written by /lask:director-on)
//   3. $LASK_DIRECTOR        -> ON|OFF (settings.json "env", or a one-shot launch)
//   4. default               -> OFF
//
// <state> is ~/.claude/lask (override with $LASK_STATE_DIR). Deliberately NOT
// ${CLAUDE_PLUGIN_DATA}: slash commands cannot rely on that variable expanding, and
// both the hooks and the toggle command must compute the same path independently.
//
// Fail-open on any fs error means "fall through to the next rule", never a crash:
// a broken gate degrades to the default, and the hooks themselves stay fail-open.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ON_TOKENS = new Set(['1', 'on', 'true', 'yes', 'enable', 'enabled']);
const OFF_TOKENS = new Set(['0', 'off', 'false', 'no', 'disable', 'disabled']);

function stateDir() {
  const override = process.env.LASK_STATE_DIR;
  if (override && override.trim() && !override.includes('${')) return override;
  return path.join(os.homedir(), '.claude', 'lask');
}

function flagPaths() {
  const dir = stateDir();
  return { dir, on: path.join(dir, 'director.on'), off: path.join(dir, 'director.off') };
}

function envVerdict() {
  const raw = process.env.LASK_DIRECTOR;
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (ON_TOKENS.has(v)) return true;
  if (OFF_TOKENS.has(v)) return false;
  return null; // unrecognised value -> not a vote, fall through
}

function directorEnabled() {
  const { on, off } = flagPaths();
  try {
    if (fs.existsSync(off)) return false;
    if (fs.existsSync(on)) return true;
  } catch {
    /* unreadable state dir -> defer to env / default */
  }
  const env = envVerdict();
  if (env !== null) return env;
  return false; // opt-in default
}

// Where the verdict came from — for the toggle command's status line.
function describe() {
  const { dir, on, off } = flagPaths();
  try {
    if (fs.existsSync(off)) return { enabled: false, source: `flag file ${off}`, dir };
    if (fs.existsSync(on)) return { enabled: true, source: `flag file ${on}`, dir };
  } catch {
    /* fall through */
  }
  const env = envVerdict();
  if (env !== null) return { enabled: env, source: `LASK_DIRECTOR=${process.env.LASK_DIRECTOR}`, dir };
  return { enabled: false, source: 'default (opt-in since 1.7.0)', dir };
}

module.exports = { directorEnabled, describe, flagPaths, stateDir };
