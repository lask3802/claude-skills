// Headless end-to-end checks. Cost tokens; run explicitly:
//   LASK_E2E=1 node --test plugins/lask/tests/e2e.test.mjs                        (pre-install: repo working copy via --plugin-dir)
//   LASK_E2E=1 LASK_E2E_INSTALLED=1 node --test plugins/lask/tests/e2e.test.mjs    (post-install: user-scope plugin, no --plugin-dir)
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
