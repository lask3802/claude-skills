#!/usr/bin/env node
// lask doctor: audit the Claude Code environment against the Opus 5.5 playbook checklist,
// and (--install) put the managed autonomy block into the user CLAUDE.md.
//
//   node doctor.mjs [--install] [--force] [--json] [--claude-dir <dir>] [--cwd <dir>]
//
// Read-only unless --install. --install never overwrites a locally edited block without
// --force, backs up CLAUDE.md before any change, and never overwrites design-avoid.md.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// One checkbox counter for the doctor and the resume hook (fenced examples do not count).
const { counts: taskCounts } = createRequire(import.meta.url)(path.join(PLUGIN_ROOT, "hooks", "scripts", "run-resume.js"));
const BLOCK_RE = /<!-- lask:autonomy:begin([^>]*)-->\r?\n?([\s\S]*?)<!-- lask:autonomy:end -->/;
// Blocks older lask versions managed in CLAUDE.md for components 2.0 retired. The pattern
// takes the blank lines around a block with it, so removal can leave exactly one behind.
const RETIRED_BLOCK_RE = /(?:\r?\n)*<!-- BEGIN FABLE-SENSE[^>]*-->[\s\S]*?<!-- END FABLE-SENSE -->(?:\r?\n)*/g;

// src without the retired blocks, touching nothing else; null when there are none.
function withoutRetiredBlocks(src, eol) {
  if (src == null || src.search(RETIRED_BLOCK_RE) < 0) return null;
  return src.replace(RETIRED_BLOCK_RE, (m, at, whole) => (at === 0 ? "" : at + m.length >= whole.length ? eol : eol + eol));
}

// "Think harder" lines: Opus 5.5 always thinks and sizes it itself; effort is the dial.
const THINK_RES = [
  /\bthink(?:ing)?\s+(?:very\s+|really\s+|extra\s+|more\s+)?(?:carefully|hard(?:er)?|deeply|thoroughly|step[- ]by[- ]step)\b/i,
  /\b(?:reason|work)\s+step[- ]by[- ]step\b/i,
  /\blet'?s\s+think\b/i,
  /\b(?:ultra|mega)think\b/i,
  /\btake\s+a\s+deep\s+breath\b/i,
  /(?:仔細|認真|逐步|一步一步地?)思考/,
];
// Requests to reproduce internal reasoning in the reply: can be declined and are a flag category.
// "Explain the reasoning behind the change" is a normal request and must not match.
const REASONING_RES = [
  /\b(?:show|reveal|print|output|reproduce|dump|write\s+out)\s+(?:me\s+)?your\s+(?:full\s+|internal\s+|complete\s+|raw\s+)?(?:reasoning|thinking|thought\s+process|chain[- ]of[- ]thought)\b/i,
  /\b(?:show|reveal|print|output|reproduce|dump)\s+(?:the\s+)?(?:internal|hidden|raw)\s+(?:reasoning|thinking)\b/i,
  /<thinking>/i,
  /(?:顯示|輸出|展示|寫出)你的(?:完整的?)?(?:思考|推理)(?:過程|鏈)/,
];
// A hand-written stop rule needs both halves: keep going, and stop before the risky step.
const KEEP_GOING_RE = /\bkeep going\b|\bcontinue without asking\b|\bdon'?t stop to ask\b|\bdoes(?:n'?t| not) need me, (?:take it|keep going|continue)\b|不需要我.{0,6}(?:就|請)?繼續|繼續做下去/i;
const STOP_ASK_RE = /\bstop and ask\b|\bask (?:me )?(?:first|before)\b|停下來問|先問我/i;

function parseArgs(argv) {
  const args = { install: false, force: false, json: false, claudeDir: null, cwd: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--install") args.install = true;
    else if (a === "--force") args.force = true;
    else if (a === "--json") args.json = true;
    else if (a === "--claude-dir") args.claudeDir = argv[++i];
    else if (a === "--cwd") args.cwd = argv[++i];
    else if (a.trim()) throw new Error(`unknown argument: ${a}`);
  }
  args.claudeDir ||= process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return args;
}

// Plugin output styles are namespaced by the plugin name (output-styles/tw-hybrid.md -> "lask:TW Hybrid").
export const OUTPUT_STYLE = "lask:TW Hybrid";
const chosenStyle = (s) => s?.outputStyle !== undefined && s?.outputStyle !== null && s?.outputStyle !== "";

const lf = (s) => s.replace(/\r\n/g, "\n");
const sha = (s) => crypto.createHash("sha256").update(lf(s).trim()).digest("hex").slice(0, 12);

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readJson(file) {
  const src = readText(file);
  if (src == null) return null;
  try {
    return JSON.parse(src.replace(/^﻿/, "")); // PowerShell 5.1 Set-Content -Encoding UTF8 writes a BOM
  } catch {
    return null;
  }
}

export function pluginVersion() {
  return readJson(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"))?.version ?? "0.0.0";
}

export function templateBody() {
  return lf(fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "claude-md-autonomy.md"), "utf8")).trim();
}

export function renderBlock(version = pluginVersion(), body = templateBody()) {
  return (
    `<!-- lask:autonomy:begin v${version} sha:${sha(body)} — managed by /lask:doctor --install; ` +
    `edit the plugin template or remove these markers to take ownership -->\n${body}\n<!-- lask:autonomy:end -->`
  );
}

// State of the managed block in one CLAUDE.md source.
export function blockState(src, body = templateBody()) {
  const m = src == null ? null : src.match(BLOCK_RE);
  if (!m) return { state: src != null && /lask:autonomy:(?:begin|end)/.test(src) ? "broken" : "missing" };
  const markerSha = (m[1].match(/sha:([0-9a-f]+)/) || [])[1] || "";
  const version = (m[1].match(/v(\d+\.\d+\.\d+)/) || [])[1] || "?";
  const edited = sha(m[2]) !== markerSha;
  const current = markerSha === sha(body);
  return { state: edited ? "edited" : current ? "current" : "outdated", version, current };
}

function walk(dir, depth, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) walk(p, depth - 1, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

// Instruction files Claude Code loads as standing context or prompts.
export function instructionFiles(claudeDir, cwd) {
  const files = [
    path.join(claudeDir, "CLAUDE.md"),
    ...walk(path.join(claudeDir, "rules"), 3, []),
    ...walk(path.join(claudeDir, "agents"), 2, []),
    ...walk(path.join(claudeDir, "commands"), 2, []),
    ...walk(path.join(claudeDir, "output-styles"), 1, []),
    ...skillFiles(path.join(claudeDir, "skills")),
    path.join(cwd, "CLAUDE.md"),
    path.join(cwd, "CLAUDE.local.md"),
    path.join(cwd, "AGENTS.md"),
    path.join(cwd, ".claude", "CLAUDE.md"),
    ...walk(path.join(cwd, ".claude", "rules"), 3, []),
    ...walk(path.join(cwd, ".claude", "agents"), 2, []),
    ...walk(path.join(cwd, ".claude", "commands"), 2, []),
    ...skillFiles(path.join(cwd, ".claude", "skills")),
    ...skillFiles(path.join(cwd, ".agents", "skills")),
  ];
  const seen = new Set();
  return files.filter((f) => {
    const key = path.resolve(f).toLowerCase();
    if (seen.has(key) || !fs.existsSync(f)) return false;
    seen.add(key);
    return true;
  });
}

function skillFiles(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name, "SKILL.md"));
}

export function scan(files, regexes) {
  const hits = [];
  for (const f of files) {
    const lines = lf(readText(f) ?? "").split("\n");
    lines.forEach((line, i) => {
      if (regexes.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  return hits;
}

// Memory files: the standing instructions a stop rule can live in (not skills or agents).
export function memoryFiles(claudeDir, cwd) {
  return [
    path.join(claudeDir, "CLAUDE.md"),
    ...walk(path.join(claudeDir, "rules"), 3, []),
    path.join(cwd, "CLAUDE.md"),
    path.join(cwd, "CLAUDE.local.md"),
    path.join(cwd, "AGENTS.md"),
    path.join(cwd, ".claude", "CLAUDE.md"),
    ...walk(path.join(cwd, ".claude", "rules"), 3, []),
  ].filter((f) => fs.existsSync(f));
}

// A hand-written stop rule: one file with both a keep-going and a stop-and-ask clause,
// outside the managed block. Returns "path:line: text" or null.
export function handWrittenStopRule(files) {
  for (const f of files) {
    const lines = lf(readText(f) ?? "").replace(BLOCK_RE, (m) => m.replace(/[^\n]/g, "")).split("\n");
    const stop = lines.findIndex((l) => STOP_ASK_RE.test(l));
    if (stop >= 0 && lines.some((l) => KEEP_GOING_RE.test(l))) return `${f}:${stop + 1}: ${lines[stop].trim().slice(0, 100)}`;
  }
  return null;
}

const SETTINGS_SOURCES = (claudeDir, cwd) => [
  [path.join(cwd, ".claude", "settings.local.json"), "project local"],
  [path.join(cwd, ".claude", "settings.json"), "project"],
  [path.join(claudeDir, "settings.local.json"), "user local"],
  [path.join(claudeDir, "settings.json"), "user"],
];

// First settings file (highest precedence) that sets the value.
function setting(claudeDir, cwd, pick) {
  for (const [file, scope] of SETTINGS_SOURCES(claudeDir, cwd)) {
    const v = pick(readJson(file) ?? {});
    if (v !== undefined) return { value: v, scope };
  }
  return { value: undefined, scope: "built-in" };
}

export function runChecks({ claudeDir, cwd }) {
  const checks = [];
  const add = (id, status, title, detail, fix) => checks.push({ id, status, title, detail, fix });
  const userMd = path.join(claudeDir, "CLAUDE.md");
  const files = instructionFiles(claudeDir, cwd);

  // 1. Stop rule: when to keep going, when to stop, stop before destructive.
  const st = blockState(readText(userMd));
  if (st.state === "current") add("stop-rule", "PASS", "CLAUDE.md says when to keep going and when to stop", `managed block v${st.version} in ${userMd}`);
  else if (st.state === "outdated")
    add("stop-rule", "WARN", "CLAUDE.md stop rule is from an older lask", `managed block v${st.version}; template changed since`, "/lask:doctor --install");
  else if (st.state === "edited")
    add(
      "stop-rule",
      st.current ? "PASS" : "WARN",
      "CLAUDE.md stop rule is locally edited",
      st.current ? "edits kept; --install leaves it alone" : "template changed since your edit; merge by hand or --install --force",
      st.current ? undefined : "/lask:doctor --install --force (backs up first)",
    );
  else {
    const custom = handWrittenStopRule(memoryFiles(claudeDir, cwd));
    if (custom) add("stop-rule", "PASS", "a hand-written stop rule exists", custom);
    else if (st.state === "broken") add("stop-rule", "WARN", "CLAUDE.md has a lone lask:autonomy marker", userMd, "restore or remove the marker by hand");
    else add("stop-rule", "FAIL", "no CLAUDE.md rule says when to stop and when to keep going", `checked ${userMd} and the project memory files`, "/lask:doctor --install");
  }

  // 1b. Blocks for retired components (they point at skills that no longer exist).
  const retired = (readText(userMd) ?? "").match(RETIRED_BLOCK_RE);
  if (retired) add("retired-blocks", "WARN", "CLAUDE.md still carries the retired fable-sense block", `${userMd}: it points at lask:fable-sense, which 2.0 removed`, "/lask:doctor --install (removes it, backs up first)");

  // 2. No "think hard" lines.
  const think = scan(files, THINK_RES);
  if (think.length) add("think-lines", "WARN", `${think.length} "think harder" line(s) in standing instructions`, think.join("\n"), "delete them; change effort instead (/effort)");
  else add("think-lines", "PASS", 'no "think harder" lines in standing instructions', `${files.length} file(s) scanned`);

  // 3. No requests to reproduce internal reasoning.
  const reasoning = scan(files, REASONING_RES);
  if (reasoning.length)
    add("reasoning-requests", "WARN", `${reasoning.length} request(s) to show internal reasoning`, reasoning.join("\n"), 'ask for what you need instead: "explain the choice in three sentences"');
  else add("reasoning-requests", "PASS", "no requests to reproduce internal reasoning", `${files.length} file(s) scanned`);

  // 4. Destructive commands still prompt.
  const hooks = readText(path.join(PLUGIN_ROOT, "hooks", "hooks.json")) ?? "";
  const pm = setting(claudeDir, cwd, (s) => s.permissions?.defaultMode);
  const mode = `permission mode: ${pm.value ?? "default"} (${pm.scope})`;
  const hooksOff = setting(claudeDir, cwd, (s) => s.disableAllHooks);
  const guardOff = /^(0|off|false)$/i.test(process.env.LASK_GUARD ?? "");
  if (!hooks.includes("destructive-guard.js")) add("destructive-guard", "FAIL", "destructive-command guard hook is not wired", "hooks/hooks.json");
  else if (hooksOff.value === true) add("destructive-guard", "FAIL", "disableAllHooks is set, so the guard never runs", `${hooksOff.scope} settings; ${mode}`, "remove disableAllHooks");
  else if (guardOff) add("destructive-guard", "WARN", "destructive-command guard disabled by LASK_GUARD", mode, "unset LASK_GUARD");
  else add("destructive-guard", "PASS", "destructive shell commands ask before running", `${mode}; headless (-p) runs deny them instead`);

  // 5. Design avoid list.
  const avoid = path.join(claudeDir, "lask", "design-avoid.md");
  if (fs.existsSync(avoid)) {
    const n = lf(readText(avoid) ?? "").split("\n").filter((l) => /^\s*-\s+\S/.test(l)).length;
    add("design-avoid", "PASS", "design requests carry a list of styles to leave out", `${n} pattern(s) in ${avoid}`);
  } else add("design-avoid", "WARN", "no user-wide design avoid list", avoid, "/lask:doctor --install (seeds it)");

  // 5b. Output style: the plugin ships one; a setting has to select it on each machine.
  const style = setting(claudeDir, cwd, (s) => (chosenStyle(s) ? s.outputStyle : undefined));
  const userSettings = path.join(claudeDir, "settings.json");
  if (style.value === OUTPUT_STYLE) add("output-style", "PASS", `replies use the ${OUTPUT_STYLE} output style`, `outputStyle (${style.scope})`);
  else if (style.value !== undefined)
    add("output-style", "INFO", "output style chosen elsewhere", `outputStyle: ${JSON.stringify(style.value)} (${style.scope}); kept — lask also ships ${OUTPUT_STYLE}`);
  else if (readText(userSettings) != null && readJson(userSettings) == null)
    add("output-style", "WARN", "no output style selected, and user settings are not plain JSON", userSettings, "fix the JSON by hand, then /lask:doctor --install");
  else add("output-style", "WARN", "no output style selected", `lask ships ${OUTPUT_STYLE}: spoken conclusions, cause before procedure, symmetric facts`, `/lask:doctor --install (sets it in ${userSettings})`);

  // 6. Task list in a file (informational: only a run in progress has one).
  const tasks = readText(path.join(cwd, "TASKS.md"));
  if (tasks != null) {
    const c = taskCounts(tasks);
    add("tasks-file", "INFO", "TASKS.md in this directory", `${c.open} open, ${c.done} done${c.contract ? "" : " (no Done means: line, so the resume hook ignores it)"}`);
  } else add("tasks-file", "INFO", "no TASKS.md here", "long runs keep one (the autonomy block says how)");

  // 7. Model and effort (the dial that replaces "think harder").
  const model = setting(claudeDir, cwd, (s) => s.model);
  const effort = setting(claudeDir, cwd, (s) => s.effortLevel);
  add("model-effort", "INFO", "model and effort", `model: ${model.value ?? "default"} (${model.scope}); effortLevel: ${effort.value ?? "default"} (${effort.scope})`);

  // 8. What happens when a message is flagged.
  const flag = setting(claudeDir, cwd, (s) => s.switchModelsOnFlag);
  add(
    "flag-switch",
    "INFO",
    "when a message is flagged",
    flag.value === false
      ? `switchModelsOnFlag: false (${flag.scope}) — the session pauses and asks`
      : `switchModelsOnFlag: ${flag.value ?? "not set"} (${flag.scope}) — the session moves to an older model; /model switches back`,
  );
  return checks;
}

export function install({ claudeDir, force }) {
  const actions = [];
  const userMd = path.join(claudeDir, "CLAUDE.md");
  const original = readText(userMd);
  const eol = original && original.includes("\r\n") ? "\r\n" : "\n";
  const stripped = withoutRetiredBlocks(original, eol);
  if (stripped != null) actions.push(`removed the retired fable-sense block from ${userMd}`);
  const src = stripped ?? original;
  const st = blockState(src);
  const block = renderBlock().replace(/\n/g, eol);
  let next = stripped;
  const own = st.state === "missing" ? handWrittenStopRule([userMd, ...walk(path.join(claudeDir, "rules"), 3, [])]) : null;
  if (st.state === "broken") actions.push(`${userMd} has a lone lask:autonomy marker; fix it by hand — the autonomy block was not written`);
  else if (own && !force) actions.push(`kept your own stop rule (${own}); the block was not added (--force adds it anyway)`);
  else if (st.state === "missing") next = src == null || !src.trim() ? block + eol : src.replace(/\s*$/, "") + eol + eol + block + eol;
  else if (st.state === "outdated" || (st.state === "edited" && force)) next = src.replace(BLOCK_RE, () => block);
  const rewrote = next != null && next !== src;
  if (next != null) {
    fs.mkdirSync(claudeDir, { recursive: true });
    if (original != null) {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
      const backup = `${userMd}.bak-lask-${stamp}`;
      fs.copyFileSync(userMd, backup);
      actions.push(`backed up ${userMd} -> ${backup}`);
    }
    fs.writeFileSync(userMd, next);
    if (rewrote) actions.push(`${st.state === "missing" ? "added" : "updated"} the autonomy block (v${pluginVersion()}) in ${userMd}`);
  }
  if (!rewrote && st.state === "edited") actions.push(`left the locally edited autonomy block in ${userMd} alone (--force to replace)`);
  else if (!rewrote && st.state === "current") actions.push(`autonomy block in ${userMd} already current`);

  const avoid = path.join(claudeDir, "lask", "design-avoid.md");
  if (!fs.existsSync(avoid)) {
    fs.mkdirSync(path.dirname(avoid), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN_ROOT, "templates", "design-avoid.md"), avoid);
    actions.push(`seeded ${avoid}`);
  } else actions.push(`kept existing ${avoid}`);

  // Select the plugin's output style only where none is chosen: /output-style writes project-local
  // settings, so user-wide selection has to live in the user settings file.
  const settingsFile = path.join(claudeDir, "settings.json");
  const settingsSrc = readText(settingsFile);
  const settings = settingsSrc == null ? {} : readJson(settingsFile);
  const userLocal = path.join(claudeDir, "settings.local.json");
  if (settings == null || typeof settings !== "object" || Array.isArray(settings))
    actions.push(`${settingsFile} is not a JSON object; outputStyle was not set`);
  else if (chosenStyle(settings)) actions.push(`kept outputStyle ${JSON.stringify(settings.outputStyle)} in ${settingsFile}`);
  else if (chosenStyle(readJson(userLocal))) actions.push(`kept outputStyle ${JSON.stringify(readJson(userLocal).outputStyle)} in ${userLocal}`);
  else try {
    const eol = settingsSrc && settingsSrc.includes("\r\n") ? "\r\n" : "\n";
    if (settingsSrc != null) {
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
      fs.copyFileSync(settingsFile, `${settingsFile}.bak-lask-${stamp}`);
      actions.push(`backed up ${settingsFile} -> ${settingsFile}.bak-lask-${stamp}`);
    }
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(settingsFile, (JSON.stringify({ ...settings, outputStyle: OUTPUT_STYLE }, null, 2) + "\n").replace(/\n/g, eol));
    actions.push(`set outputStyle "${OUTPUT_STYLE}" in ${settingsFile}`);
  } catch (e) {
    actions.push(`could not write ${settingsFile} (${e.code ?? e.message}); outputStyle was not set`);
  }
  return actions;
}

function format(checks, actions) {
  const out = [`lask doctor ${pluginVersion()} — Opus 5.5 playbook checklist`, ""];
  if (actions.length) out.push(...actions.map((a) => `* ${a}`), "");
  for (const c of checks) {
    out.push(`${c.status.padEnd(4)}  ${c.id.padEnd(18)} ${c.title}`);
    for (const line of String(c.detail ?? "").split("\n").filter(Boolean)) out.push(`      ${line}`);
    if (c.fix && c.status !== "PASS") out.push(`      fix: ${c.fix}`);
  }
  return out.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const actions = args.install ? install(args) : [];
  const checks = runChecks(args);
  if (args.json) process.stdout.write(JSON.stringify({ version: pluginVersion(), actions, checks }, null, 2) + "\n");
  else process.stdout.write(format(checks, actions) + "\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    process.stderr.write(`lask doctor: ${e.message}\n`);
    process.exitCode = 2;
  }
}
