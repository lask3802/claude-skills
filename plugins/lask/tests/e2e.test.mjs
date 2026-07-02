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

test("e2e: both lask skills are registered", { skip: !ENABLED && "set LASK_E2E=1" }, () => {
  const out = claude(
    'List every skill available to you whose name starts with "lask:", comma-separated, nothing else.',
  );
  for (const s of ["director", "delegation-playbooks"])
    assert.match(out, new RegExp(`lask:${s}`), `skill lask:${s} must be listed`);
});

// Optional dispatch-proof: headless spawn of lask:scout that must echo a sentinel back
// through the director. Double-gated (LASK_E2E=1 AND LASK_E2E_DISPATCH=1) so it never
// runs in the default suite; opt in explicitly when you want to confirm live dispatch.
const DISPATCH = process.env.LASK_E2E_DISPATCH === "1";
test(
  "e2e: lask:scout dispatch relays a sentinel",
  { skip: (!ENABLED || !DISPATCH) && "set LASK_E2E=1 and LASK_E2E_DISPATCH=1" },
  () => {
    const sentinel = "LASK-SCOUT-OK-4213";
    const out = claude(
      `Dispatch the lask:scout agent with this instruction: reply with exactly the token ${sentinel} ` +
        `and nothing else. Then output only the token the scout returned, nothing else.`,
    );
    assert.match(out, new RegExp(sentinel), "scout dispatch must relay the sentinel token");
  },
);
