// Behavior tests for scripts/doctor.mjs (the Opus 5.5 playbook audit and --install).
//   node --test plugins/lask/tests/doctor.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCTOR = path.join(PLUGIN_ROOT, "scripts", "doctor.mjs");

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lask-doctor-"));
  const claudeDir = path.join(root, "claude");
  const cwd = path.join(root, "proj");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  return { root, claudeDir, cwd, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function doctor(box, ...extra) {
  const out = execFileSync(process.execPath, [DOCTOR, "--json", "--claude-dir", box.claudeDir, "--cwd", box.cwd, ...extra], {
    encoding: "utf8",
    env: { ...process.env, LASK_GUARD: "" },
  });
  const report = JSON.parse(out);
  report.byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
  return report;
}

test("a bare setup fails the stop rule and warns about the design list", () => {
  const box = sandbox();
  try {
    const r = doctor(box);
    assert.equal(r.byId["stop-rule"].status, "FAIL");
    assert.equal(r.byId["design-avoid"].status, "WARN");
    assert.equal(r.byId["think-lines"].status, "PASS");
    assert.equal(r.byId["destructive-guard"].status, "PASS", "the plugin wires the guard");
    assert.equal(r.actions.length, 0, "read-only without --install");
    assert.ok(!fs.existsSync(path.join(box.claudeDir, "CLAUDE.md")));
  } finally {
    box.done();
  }
});

test("--install adds the managed block once, backs up, preserves CRLF, and seeds the avoid list", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    fs.writeFileSync(md, "# Mine\r\n\r\nkeep this line\r\n");
    const r = doctor(box, "--install");
    const src = fs.readFileSync(md, "utf8");
    assert.match(src, /^# Mine\r\n\r\nkeep this line\r\n/, "user content untouched");
    assert.match(src, /<!-- lask:autonomy:begin v\d+\.\d+\.\d+ sha:[0-9a-f]{12}/);
    assert.match(src, /Stop and ask only when/);
    assert.match(src, /Blocked on me/);
    assert.ok(!/[^\r]\n/.test(src), "line endings follow the file (CRLF)");
    assert.equal(r.byId["stop-rule"].status, "PASS");
    assert.equal(r.byId["design-avoid"].status, "PASS");
    assert.ok(fs.readdirSync(box.claudeDir).some((f) => f.startsWith("CLAUDE.md.bak-lask-")), "backup written");
    const again = doctor(box, "--install");
    assert.equal((fs.readFileSync(md, "utf8").match(/lask:autonomy:begin/g) || []).length, 1, "idempotent");
    assert.match(again.actions.join("\n"), /already current/);
  } finally {
    box.done();
  }
});

test("an outdated block is replaced; a locally edited block is kept unless --force", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    doctor(box, "--install");
    const installed = fs.readFileSync(md, "utf8");

    // Outdated: marker hash matches its (old) content, but not the current template.
    const oldBody = "## Autonomy and stops\n\n- an older rule";
    const oldSha = createHash("sha256").update(oldBody).digest("hex").slice(0, 12);
    fs.writeFileSync(md, installed.replace(/<!-- lask:autonomy:begin[\s\S]*<!-- lask:autonomy:end -->/, `<!-- lask:autonomy:begin v2.0.0 sha:${oldSha} -->\n${oldBody}\n<!-- lask:autonomy:end -->`));
    assert.equal(doctor(box).byId["stop-rule"].status, "WARN");
    doctor(box, "--install");
    assert.match(fs.readFileSync(md, "utf8"), /Stop and ask only when/);
    assert.equal(doctor(box).byId["stop-rule"].status, "PASS");

    // Edited in place: kept.
    fs.writeFileSync(md, fs.readFileSync(md, "utf8").replace("Stop and ask only when", "Stop and ask me only when"));
    const edited = doctor(box, "--install");
    assert.match(edited.actions.join("\n"), /locally edited/);
    assert.match(fs.readFileSync(md, "utf8"), /Stop and ask me only when/);
    doctor(box, "--install", "--force");
    assert.doesNotMatch(fs.readFileSync(md, "utf8"), /Stop and ask me only when/);
  } finally {
    box.done();
  }
});

test("think-harder lines and reasoning-reproduction requests are reported with path:line", () => {
  const box = sandbox();
  try {
    fs.writeFileSync(path.join(box.cwd, "CLAUDE.md"), "# Proj\nAlways think step by step before answering.\n");
    fs.mkdirSync(path.join(box.claudeDir, "rules"), { recursive: true });
    fs.writeFileSync(path.join(box.claudeDir, "rules", "style.md"), "ok\n請仔細思考再回答\nShow your full reasoning in the reply.\n");
    const r = doctor(box);
    assert.equal(r.byId["think-lines"].status, "WARN");
    assert.match(r.byId["think-lines"].detail, /CLAUDE\.md:2:/);
    assert.match(r.byId["think-lines"].detail, /style\.md:2:/);
    assert.equal(r.byId["reasoning-requests"].status, "WARN");
    assert.match(r.byId["reasoning-requests"].detail, /style\.md:3:/);
  } finally {
    box.done();
  }
});

test("a hand-written stop rule counts; TASKS.md progress is reported", () => {
  const box = sandbox();
  try {
    fs.writeFileSync(path.join(box.cwd, "AGENTS.md"), "When a step doesn't need me, keep going. Stop and ask before deleting data.\n");
    fs.writeFileSync(path.join(box.cwd, "TASKS.md"), "- [x] a\n- [ ] b\n- [ ] c\n");
    const r = doctor(box);
    assert.equal(r.byId["stop-rule"].status, "PASS");
    assert.match(r.byId["stop-rule"].detail, /AGENTS\.md:1/);
    assert.match(r.byId["tasks-file"].detail, /2 open, 1 done/);
  } finally {
    box.done();
  }
});

test("--install backs up the exact original and never overwrites an existing avoid list", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    const original = "# Mine\n\nline one\n";
    fs.writeFileSync(md, original);
    const avoid = path.join(box.claudeDir, "lask", "design-avoid.md");
    fs.mkdirSync(path.dirname(avoid), { recursive: true });
    fs.writeFileSync(avoid, "- my own list\n");
    doctor(box, "--install");
    const backup = fs.readdirSync(box.claudeDir).find((f) => f.startsWith("CLAUDE.md.bak-lask-"));
    assert.equal(fs.readFileSync(path.join(box.claudeDir, backup), "utf8"), original, "the backup holds the pre-install bytes");
    assert.equal(fs.readFileSync(avoid, "utf8"), "- my own list\n");
  } finally {
    box.done();
  }
});

test("--install does not stack a second stop rule on a hand-written one or a broken block", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    const own = "# Mine\n\nWhen a step doesn't need me, keep going.\nStop and ask before anything destructive.\n";
    fs.writeFileSync(md, own);
    const r = doctor(box, "--install");
    assert.equal(fs.readFileSync(md, "utf8"), own, "own rule kept, nothing appended");
    assert.match(r.actions.join("\n"), /kept your own stop rule/);
    assert.equal(r.byId["stop-rule"].status, "PASS");
    doctor(box, "--install", "--force");
    assert.match(fs.readFileSync(md, "utf8"), /lask:autonomy:begin/, "--force still adds it");

    fs.writeFileSync(md, "# Mine\n<!-- lask:autonomy:begin v2.1.0 sha:abc -->\nhalf a block\n");
    const broken = doctor(box, "--install", "--force");
    assert.match(broken.actions.join("\n"), /lone lask:autonomy marker/);
    assert.equal(fs.readFileSync(md, "utf8"), "# Mine\n<!-- lask:autonomy:begin v2.1.0 sha:abc -->\nhalf a block\n");
    assert.equal(broken.byId["stop-rule"].status, "WARN");
  } finally {
    box.done();
  }
});

test("the retired fable-sense block is flagged, and --install removes it with a backup", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    const fable =
      "<!-- BEGIN FABLE-SENSE (managed by the lask plugin — plugins/lask/skills/fable-sense; edit there, not here) -->\r\n" +
      "## Hard-task discipline\r\n\r\ninvoke the `lask:fable-sense` skill\r\n<!-- END FABLE-SENSE -->\r\n";
    const own = "When a step doesn't need me, keep going.\r\nStop and ask before anything destructive.\r\n";
    fs.writeFileSync(md, `# Mine\r\n\r\n${fable}\r\n## Language\r\n\r\n${own}`);
    const before = doctor(box);
    assert.equal(before.byId["retired-blocks"].status, "WARN");
    const r = doctor(box, "--install");
    const src = fs.readFileSync(md, "utf8");
    assert.equal(src, `# Mine\r\n\r\n## Language\r\n\r\n${own}`, "block gone, surrounding text and CRLF intact, own stop rule kept");
    assert.match(r.actions.join("\n"), /removed the retired fable-sense block/);
    assert.match(r.actions.join("\n"), /kept your own stop rule/);
    const backups = fs.readdirSync(box.claudeDir).filter((f) => f.startsWith("CLAUDE.md.bak-lask-"));
    assert.equal(backups.length, 1);
    assert.match(fs.readFileSync(path.join(box.claudeDir, backups[0]), "utf8"), /BEGIN FABLE-SENSE/);
    assert.equal(r.byId["retired-blocks"], undefined, "no warning once removed");
  } finally {
    box.done();
  }
});

test("removing a retired block touches nothing else, wherever the block sits", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    const own = "When a step doesn't need me, keep going.\nStop and ask before anything destructive.\n"; // no block gets added
    const block = "<!-- BEGIN FABLE-SENSE (managed) -->\n## Hard-task discipline\n<!-- END FABLE-SENSE -->";
    const fence = "```text\nline one\n\n\nline two after two blank lines\n```\n";
    const cases = [
      [`${block}\n\n# Mine\n${fence}${own}`, `# Mine\n${fence}${own}`],
      [`# Mine\n${fence}${own}\n${block}\n`, `# Mine\n${fence}${own}`],
      [`# Mine\n\n\n\nspaced\n\n${block}\n\n${fence}${own}`, `# Mine\n\n\n\nspaced\n\n${fence}${own}`],
    ];
    for (const [before, after] of cases) {
      fs.writeFileSync(md, before);
      const r = doctor(box, "--install");
      assert.equal(fs.readFileSync(md, "utf8"), after);
      assert.match(r.actions.join("\n"), /removed the retired fable-sense block/);
    }
    fs.writeFileSync(md, `# Mine\n${fence}${own}`);
    const r = doctor(box, "--install");
    assert.equal(fs.readFileSync(md, "utf8"), `# Mine\n${fence}${own}`, "blank-line runs outside a block are never collapsed");
    assert.doesNotMatch(r.actions.join("\n"), /removed the retired|backed up/, "no block, no removal claimed, no rewrite");
  } finally {
    box.done();
  }
});

test("taking ownership by removing the markers never leads to a second copy", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    const template = fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "claude-md-autonomy.md"), "utf8");
    fs.writeFileSync(md, `# Mine\n\n${template}`);
    const r = doctor(box, "--install");
    assert.equal((fs.readFileSync(md, "utf8").match(/Stop and ask only when/g) || []).length, 1);
    assert.equal(r.byId["stop-rule"].status, "PASS");
    fs.writeFileSync(md, "# Mine\n\nFinish each task before starting the next one. Keep going.\n");
    assert.equal(doctor(box).byId["stop-rule"].status, "FAIL", "'task before' is not 'ask before'");
    fs.writeFileSync(md, "# Mine\n\nWhen the next step does not need me, take it.\nStop and ask before deleting data.\n");
    assert.equal(doctor(box).byId["stop-rule"].status, "PASS", "the playbook's own phrasing counts as keep-going");
  } finally {
    box.done();
  }
});

test("replacing the block keeps the text around it", () => {
  const box = sandbox();
  try {
    const md = path.join(box.claudeDir, "CLAUDE.md");
    doctor(box, "--install");
    const withBlock = fs.readFileSync(md, "utf8");
    fs.writeFileSync(md, `# Before\n\n${withBlock.replace("Stop and ask only when", "Stop and ask me only when")}\n## After\nkeep me\n`);
    doctor(box, "--install", "--force");
    const out = fs.readFileSync(md, "utf8");
    assert.match(out, /^# Before\n/);
    assert.match(out, /## After\nkeep me\n$/);
    assert.doesNotMatch(out, /Stop and ask me only when/);
  } finally {
    box.done();
  }
});

test("only memory files count as a stop rule, and both halves are required", () => {
  const box = sandbox();
  try {
    const skill = path.join(box.claudeDir, "skills", "x");
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: x\n---\nIf a test flakes, re-run it and keep going. Stop and ask if it fails twice.\n");
    assert.equal(doctor(box).byId["stop-rule"].status, "FAIL", "a skill is not standing policy");
    fs.writeFileSync(path.join(box.cwd, "CLAUDE.md"), "Keep going between steps.\n");
    assert.equal(doctor(box).byId["stop-rule"].status, "FAIL", "keep-going without a stop clause is not a stop rule");
  } finally {
    box.done();
  }
});

test("normal requests for an explanation are not flagged as reasoning reproduction", () => {
  const box = sandbox();
  try {
    fs.writeFileSync(path.join(box.cwd, "CLAUDE.md"), "Explain the reasoning behind each change.\nInclude the reasoning for each finding.\n");
    assert.equal(doctor(box).byId["reasoning-requests"].status, "PASS");
  } finally {
    box.done();
  }
});

test("settings: disableAllHooks fails the guard check; switchModelsOnFlag and fenced tasks are reported", () => {
  const box = sandbox();
  try {
    fs.writeFileSync(path.join(box.claudeDir, "settings.json"), JSON.stringify({ disableAllHooks: true, switchModelsOnFlag: false }));
    fs.writeFileSync(path.join(box.cwd, "TASKS.md"), "Done means: x\n```\n- [ ] example\n```\n- [ ] real\n");
    const r = doctor(box);
    assert.equal(r.byId["destructive-guard"].status, "FAIL");
    assert.match(r.byId["flag-switch"].detail, /switchModelsOnFlag: false/);
    assert.match(r.byId["tasks-file"].detail, /^1 open, 0 done$/);
  } finally {
    box.done();
  }
});

test("--install selects the plugin output style once, keeping other settings, CRLF and a backup", () => {
  const box = sandbox();
  try {
    const file = path.join(box.claudeDir, "settings.json");
    const original = '{\r\n  "model": "opus",\r\n  "permissions": {\r\n    "allow": []\r\n  }\r\n}\r\n';
    fs.writeFileSync(file, original);
    assert.equal(doctor(box).byId["output-style"].status, "WARN");
    const r = doctor(box, "--install");
    const after = fs.readFileSync(file, "utf8");
    assert.deepEqual(JSON.parse(after), { model: "opus", permissions: { allow: [] }, outputStyle: "lask:TW Hybrid" });
    assert.ok(!/[^\r]\n/.test(after), "line endings follow the file (CRLF)");
    const backups = fs.readdirSync(box.claudeDir).filter((f) => f.startsWith("settings.json.bak-lask-"));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(box.claudeDir, backups[0]), "utf8"), original, "backup is the exact original");
    assert.equal(r.byId["output-style"].status, "PASS");
    assert.match(r.byId["output-style"].detail, /\(user\)/);
    const again = doctor(box, "--install");
    assert.match(again.actions.join("\n"), /kept outputStyle "lask:TW Hybrid"/);
    assert.equal(fs.readFileSync(file, "utf8"), after, "second run changes nothing");
  } finally {
    box.done();
  }
});

test("an output style chosen elsewhere is kept, and unreadable settings are never rewritten", () => {
  const box = sandbox();
  try {
    const file = path.join(box.claudeDir, "settings.json");
    fs.writeFileSync(file, JSON.stringify({ outputStyle: "Explanatory" }));
    const r = doctor(box, "--install");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).outputStyle, "Explanatory");
    assert.equal(r.byId["output-style"].status, "INFO");
    fs.mkdirSync(path.join(box.cwd, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(box.cwd, ".claude", "settings.local.json"), JSON.stringify({ outputStyle: "lask:TW Hybrid" }));
    assert.match(doctor(box).byId["output-style"].detail, /project local/, "highest-precedence source wins");
    fs.writeFileSync(file, "{ not json");
    const broken = doctor(box, "--install");
    assert.match(broken.actions.join("\n"), /not a JSON object; outputStyle was not set/);
    assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
  } finally {
    box.done();
  }
});

test("output style: creates missing settings, respects user-local, reads a BOM, and asks for a hand fix on bad JSON", () => {
  const box = sandbox();
  try {
    const file = path.join(box.claudeDir, "settings.json");
    doctor(box, "--install");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { outputStyle: "lask:TW Hybrid" }, "missing file is created");
    fs.writeFileSync(file, "﻿" + JSON.stringify({ model: "opus" }));
    fs.writeFileSync(path.join(box.claudeDir, "settings.local.json"), JSON.stringify({ outputStyle: "Explanatory" }));
    const local = doctor(box, "--install");
    assert.match(local.actions.join("\n"), /kept outputStyle "Explanatory" in .*settings\.local\.json/);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")).outputStyle, undefined, "a user-local choice blocks the write");
    fs.rmSync(path.join(box.claudeDir, "settings.local.json"));
    assert.equal(doctor(box).byId["output-style"].status, "WARN", "a BOM file still parses: plain no-style warning");
    assert.match(doctor(box).byId["output-style"].fix, /--install \(sets it/);
    fs.writeFileSync(file, "{ not json");
    assert.match(doctor(box).byId["output-style"].fix, /fix the JSON by hand/, "no fix that --install cannot perform");
  } finally {
    box.done();
  }
});

test("LASK_GUARD=0 turns the guard check into a warning", () => {
  const box = sandbox();
  try {
    const out = execFileSync(process.execPath, [DOCTOR, "--json", "--claude-dir", box.claudeDir, "--cwd", box.cwd], {
      encoding: "utf8",
      env: { ...process.env, LASK_GUARD: "0" },
    });
    const guard = JSON.parse(out).checks.find((c) => c.id === "destructive-guard");
    assert.equal(guard.status, "WARN");
  } finally {
    box.done();
  }
});

test("text output leads with the version and exits 0; bad flags exit 2", () => {
  const box = sandbox();
  try {
    const out = execFileSync(process.execPath, [DOCTOR, "--claude-dir", box.claudeDir, "--cwd", box.cwd], { encoding: "utf8" });
    assert.match(out, /^lask doctor \d+\.\d+\.\d+ — Opus 5\.5 playbook checklist/);
    assert.match(out, /FAIL  stop-rule/);
    assert.throws(
      () => execFileSync(process.execPath, [DOCTOR, "--nope"], { encoding: "utf8", stdio: "pipe" }),
      (e) => e.status === 2,
    );
  } finally {
    box.done();
  }
});
