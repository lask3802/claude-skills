#!/usr/bin/env node
// Validate the lask plugin: JSON manifests parse, every agent/skill has well-formed
// YAML frontmatter with the required fields, names are tool-safe, and descriptions
// are present and within length limits. Treats agents + skills as code: this is their
// unit test. Exit non-zero on any failure so it can gate a commit / CI.
//
// Usage: node scripts/validate-plugin.mjs            (from repo root)
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repoRoot, 'plugins', 'lask');

let errors = 0;
let checks = 0;
const fail = (m) => { errors++; console.error('  ✗ ' + m); };
const ok = (m) => { checks++; console.log('  ✓ ' + m); };

// --- minimal frontmatter extractor (no external deps) ---
function frontmatter(text, file) {
  if (!text.startsWith('---')) { fail(`${file}: missing opening --- frontmatter`); return null; }
  const end = text.indexOf('\n---', 3);
  if (end === -1) { fail(`${file}: missing closing --- frontmatter`); return null; }
  const block = text.slice(3, end).replace(/^\r?\n/, '');
  // Parse top-level "key:" lines; support YAML folded/literal/plain multi-line scalars.
  const lines = block.split(/\r?\n/);
  const fm = {};
  let curKey = null;
  let curIndent = 0;
  for (const line of lines) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    const indent = line.length - line.trimStart().length;
    if (m && indent === 0) {
      curKey = m[1];
      curIndent = indent;
      let val = m[2].trim();
      // folded/literal block scalar markers
      if (val === '>-' || val === '>' || val === '|' || val === '|-' || val === '') {
        fm[curKey] = '';
      } else {
        fm[curKey] = val.replace(/^["']|["']$/g, '');
      }
    } else if (curKey && indent > curIndent && line.trim()) {
      // continuation of a multi-line scalar
      fm[curKey] = (fm[curKey] ? fm[curKey] + ' ' : '') + line.trim();
    }
  }
  return fm;
}

function checkName(name, file, kind) {
  if (!name) { fail(`${file}: ${kind} missing 'name'`); return; }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    fail(`${file}: name "${name}" must be lowercase letters/numbers/hyphens only`);
  } else { ok(`${file}: name "${name}" valid`); }
}

function checkDescription(desc, file) {
  if (!desc) { fail(`${file}: missing 'description'`); return; }
  if (desc.length > 1024) fail(`${file}: description ${desc.length} chars > 1024 limit`);
  else ok(`${file}: description present (${desc.length} chars)`);
}

// --- 1. JSON manifests ---
console.log('JSON manifests:');
for (const rel of ['.claude-plugin/marketplace.json', 'plugins/lask/.claude-plugin/plugin.json']) {
  const p = join(repoRoot, rel);
  try { JSON.parse(readFileSync(p, 'utf8')); ok(`${rel} parses`); }
  catch (e) { fail(`${rel}: ${e.message}`); }
}

// --- 2. Agents ---
console.log('\nAgents:');
const agentsDir = join(pluginRoot, 'agents');
const agentNames = new Set();
if (existsSync(agentsDir)) {
  for (const f of readdirSync(agentsDir).filter((x) => x.endsWith('.md'))) {
    const p = join(agentsDir, f);
    const text = readFileSync(p, 'utf8');
    const fm = frontmatter(text, f);
    if (!fm) continue;
    checkName(fm.name, f, 'agent');
    checkDescription(fm.description, f);
    if (fm.name && fm.name !== basename(f, '.md'))
      fail(`${f}: name "${fm.name}" should match filename "${basename(f, '.md')}"`);
    if (fm.name) agentNames.add(fm.name);
    // body must be non-trivial
    const body = text.slice(text.indexOf('\n---', 3) + 4).trim();
    if (body.length < 200) fail(`${f}: body too short (${body.length} chars) — needs a real persona prompt`);
    else ok(`${f}: body ${body.length} chars`);
  }
} else fail('agents/ directory missing');

// --- 3. Skills ---
console.log('\nSkills:');
const skillsDir = join(pluginRoot, 'skills');
for (const d of readdirSync(skillsDir)) {
  const skillMd = join(skillsDir, d, 'SKILL.md');
  if (!existsSync(skillMd)) { fail(`skills/${d}: no SKILL.md`); continue; }
  const text = readFileSync(skillMd, 'utf8');
  const fm = frontmatter(text, `${d}/SKILL.md`);
  if (!fm) continue;
  checkName(fm.name, `${d}/SKILL.md`, 'skill');
  checkDescription(fm.description, `${d}/SKILL.md`);
}

// --- 4. roast skill references real agents ---
console.log('\nCross-references:');
const roast = join(skillsDir, 'roast', 'SKILL.md');
if (existsSync(roast)) {
  const text = readFileSync(roast, 'utf8');
  const referenced = ['expander', 'first-principles', 'researcher', 'critic', 'user-advocate'];
  for (const a of referenced) {
    if (!agentNames.has(a)) fail(`roast skill expects agent "${a}" but agents/${a}.md not found/valid`);
    else if (!text.includes(a)) fail(`roast SKILL.md does not mention agent "${a}"`);
    else ok(`roast references agent "${a}" (file exists)`);
  }
}

// --- 5. Embedded workflow scripts in skills must be valid JS ---
// Skills may embed an ```js Workflow-tool script. The runtime provides `export const meta`,
// top-level await and top-level return; neutralize that sugar, then syntax-check the rest so a
// broken example (e.g. an unescaped quote) can't ship.
console.log('\nEmbedded workflow scripts:');
for (const d of readdirSync(skillsDir)) {
  const skillMd = join(skillsDir, d, 'SKILL.md');
  if (!existsSync(skillMd)) continue;
  const text = readFileSync(skillMd, 'utf8');
  const blocks = [...text.matchAll(/```js\n([\s\S]*?)\n```/g)];
  for (const [i, m] of blocks.entries()) {
    let code = m[1].replace(/^export\s+/m, '').replace(/^return\s+/m, 'void ');
    try {
      new vm.Script(`(async () => {\n${code}\n})();`);
      ok(`${d}/SKILL.md: embedded js block #${i + 1} parses`);
    } catch (e) {
      fail(`${d}/SKILL.md: embedded js block #${i + 1} syntax error: ${e.message}`);
    }
  }
}

console.log(`\n${errors === 0 ? 'PASS' : 'FAIL'}: ${checks} checks ok, ${errors} error(s).`);
process.exit(errors === 0 ? 0 : 1);
