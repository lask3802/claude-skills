#!/usr/bin/env node
// PreToolUse hook for Bash and PowerShell. Keeps a permission prompt in front of destructive
// or hard-to-undo shell commands whatever the permission mode, so "keep going" autonomy never
// runs past the one stop that matters:
//   - recursive deletes of the working directory, its ancestors, home, a drive root, a .git
//     directory, a git repository, an all-variable or computed path ("$DIR/", "$(cmd)"), or
//     anything outside the working directory (temp directories excepted); plain deletes
//     outside the working directory; the same through find -delete, xargs rm, rsync --delete
//     and PowerShell pipelines, judged by the upstream path
//   - git history or work-tree destruction (force push, remote branch delete or prune,
//     reset --hard, clean -f, branch -D, checkout/restore/switch that discard changes,
//     stash drop/clear, worktree remove --force, history rewrites)
//   - DROP / TRUNCATE / unqualified DELETE read by a database client, dropdb
//   - disk and power commands, registry publishing, image pushes, repo/release deletion
// It follows cd (scoped to subshells), shell keywords and grouping, wrappers (sudo, env, nice,
// timeout, docker/kubectl exec), command substitutions, and nested bash -c / pwsh -Command /
// cmd /c / eval. Heredoc bodies are data unless a shell or a database client reads them.
// It is a tripwire for the forms an agent actually writes, not a boundary against someone
// hiding a command on purpose.
// Decision is always "ask", never "deny": the user stays the judge. LASK_GUARD=0 disables.
// Fail-open: on any error, exit 0 with no output so the tool call proceeds unmodified.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';
const P = IS_WIN ? path.win32 : path.posix;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const PWSH = new Set(['pwsh', 'powershell']);
// Wrapper commands and the options of theirs that take a separate value.
const WRAPPERS = {
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-T', '-U'],
  doas: ['-u', '-C'],
  env: ['-u', '-C', '-S'],
  nice: ['-n'],
  ionice: ['-c', '-n', '-p'],
  timeout: ['-s', '-k'],
  stdbuf: ['-i', '-o', '-e'],
  nohup: [],
  time: [],
  command: [],
  builtin: [],
  exec: [],
};
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'elseif', 'while', 'until', 'do', '!']);
const PS_BLOCK_KEYWORDS = new Set(['if', 'elseif', 'while', 'foreach', 'for', 'switch', 'until']);
const NOT_COMMANDS = new Set(['for', 'foreach', 'case', 'select', 'function', 'fi', 'done', 'esac', 'in']);
const CD = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl', 'push-location', 'pop-location']);
const DELETERS = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
const SOURCES = new Set(['get-childitem', 'gci', 'ls', 'dir', 'get-item', 'gi']);
const FILTERS = new Set(['where-object', 'where', '?', 'select-object', 'select', 'grep', 'head', 'tail']);
const STATEMENT_SEPS = new Set([';', '\n', '&&', '||', '&']);
const DB_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlcmd', 'osql', 'isql', 'sqlite3', 'duckdb', 'invoke-sqlcmd',
  'clickhouse-client', 'redis-cli', 'mongo', 'mongosh']);
const DB_AT_COMMAND =
  /(?:^|[;&|(])\s*(?:\w+=\S*\s+)*(?:sudo\s+)?(?:psql|mysql|mariadb|sqlcmd|osql|isql|sqlite3|duckdb|invoke-sqlcmd|clickhouse-client|redis-cli|mongo(?:sh)?)\b/i;
const SHELL_AT_COMMAND = /(?:^|[;&|(])\s*(?:\w+=\S*\s+)*(?:sudo\s+)?(?:bash|sh|zsh|dash|ksh|pwsh|powershell)\b/;
const DB_RULES = [
  [/\bdrop\s+(?:table|database|schema|view|index|user|login|collection)\b/i, 'drops a database object'],
  [/\btruncate\s+(?:table\b|[\w"`[])/i, 'truncates a table'],
  [/\bdelete\s+from\s+(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s;'"]+)(?:\s*;|\s*$|\s*['"](?:\s|$)|\s+(?:limit|order)\b)/i, 'DELETE without WHERE'],
  [/\bflush(?:all|db)\b|\bdropDatabase\s*\(|\.drop\s*\(\s*\)/i, 'wipes a datastore'],
];
const RECURSE_FLAG = /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?(?::\$true)?$/i; // PowerShell -Recurse, abbreviated
const COMPUTED = /^(?:\$\([\s\S]*\)|`[^`]*`|\([\s\S]*\))$/; // a path that is only a substitution

// ---- lexing -------------------------------------------------------------------------------

// Heredoc / here-string bodies are data unless a shell executes them. Bodies read by a
// database client are returned separately so the SQL rules can read them.
function stripHeredocs(text, kind) {
  const lines = text.split(/\r?\n/);
  const out = [];
  const dbBodies = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    let end = null;
    if (kind === 'ps') {
      if (/@['"]\s*$/.test(line)) end = (l) => /^['"]@/.test(l);
    } else {
      // Quoted text and $(( )) arithmetic never open a heredoc.
      const bare = line
        .replace(/(<<-?\s*\\?)?('[^']*'|"(?:\\.|[^"\\])*")/g, (m, op) => (op ? m : ' '))
        .replace(/\$\(\([^)]*\)\)/g, ' ');
      const m = bare.match(/(?<!<)<<(?!<)(-?)\s*\\?(['"]?)([A-Za-z_][\w-]*)\2/);
      if (m) end = (l) => (m[1] === '-' ? l.replace(/^\t+/, '') : l) === m[3];
    }
    if (!end) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && !end(lines[j])) body.push(lines[j++]);
    if (SHELL_AT_COMMAND.test(line)) out.push(...body);
    if (DB_AT_COMMAND.test(line)) dbBodies.push(body.join('\n'));
    if (j < lines.length) out.push(lines[j]);
    i = j;
  }
  return { text: out.join('\n'), dbBodies };
}

// Index of the parenthesis closing the one at `open`, skipping quoted text.
function matchParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const j = text.indexOf(c, i + 1);
      if (j < 0) return text.length - 1;
      i = j;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return text.length - 1;
}

// Quote-aware split into simple commands: [{ tokens, raw, sep, seps, substs }], where seps are
// the operators before the command (; newline && || | & ( ) { }), sep the last of them, and
// substs the inner text of every command substitution in it (checked like any command).
// kind: 'sh' (backslash escapes), 'ps' (backtick escapes), 'cmd' (no escapes).
function splitCommands(text, kind) {
  const segs = [];
  let tokens = [];
  let tok = null;
  let raw = '';
  let seps = [];
  let substs = [];
  const flushTok = () => {
    if (tok !== null) tokens.push(tok);
    tok = null;
  };
  const flushSeg = (next) => {
    flushTok();
    if (tokens.length) {
      segs.push({ tokens, raw: raw.trim(), sep: seps.length ? seps[seps.length - 1] : null, seps, substs });
      seps = [];
      substs = [];
    }
    if (next) seps.push(next);
    tokens = [];
    raw = '';
  };
  const take = (from, to, value) => {
    tok = (tok ?? '') + (value ?? text.slice(from, to));
    raw += text.slice(from, to);
  };
  const esc = kind === 'sh' ? '\\' : kind === 'ps' ? '`' : null;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      const end = j < 0 ? text.length : j;
      take(i, end + 1, text.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let val = '';
      while (j < text.length && text[j] !== '"') {
        if (kind !== 'cmd' && text[j] === '$' && text[j + 1] === '(') {
          const close = matchParen(text, j + 1);
          substs.push(text.slice(j + 2, close));
          val += text.slice(j, close + 1);
          j = close + 1;
          continue;
        }
        if (kind === 'sh' && text[j] === '`') {
          const close = text.indexOf('`', j + 1);
          const end = close < 0 ? text.length : close;
          substs.push(text.slice(j + 1, end));
          val += text.slice(j, end + 1);
          j = end + 1;
          continue;
        }
        if (esc && text[j] === esc && j + 1 < text.length && (kind !== 'sh' || '$`"\\\n'.includes(text[j + 1]))) {
          val += text[j + 1];
          j += 2;
          continue;
        }
        val += text[j];
        j++;
      }
      take(i, j + 1, val);
      i = j + 1;
      continue;
    }
    if (kind === 'sh' && c === '`') {
      const close = text.indexOf('`', i + 1);
      const end = close < 0 ? text.length : close;
      substs.push(text.slice(i + 1, end));
      take(i, end + 1);
      i = end + 1;
      continue;
    }
    if (esc && c === esc && d !== undefined) {
      take(i, i + 2, d);
      i += 2;
      continue;
    }
    if (c === '$' && d === '{') {
      // ${VAR} / ${env:VAR}: one variable, never a brace group
      const j = text.indexOf('}', i + 2);
      const end = j < 0 ? text.length : j + 1;
      take(i, end);
      i = end;
      continue;
    }
    if (kind !== 'cmd' && (c === '$' || c === '<' || c === '>') && d === '(') {
      // $( ) and <( ) >( ): the inner text is a command of its own
      const close = matchParen(text, i + 1);
      substs.push(text.slice(i + 2, close));
      take(i, close + 1);
      i = close + 1;
      continue;
    }
    const two = c + (d ?? '');
    if (two === '&&' || two === '||') {
      flushSeg(two);
      i += 2;
      continue;
    }
    if (c === ';' || c === '\n' || c === '|' || (c === '&' && d !== '>' && text[i - 1] !== '>')) {
      flushSeg(c);
      i++;
      continue;
    }
    if (c === '(' && tok === null) {
      // sh: a subshell. PowerShell: grouping at statement start or after a block keyword;
      // elsewhere an argument sub-expression, kept as one computed token and checked inside.
      const psArgument = kind === 'ps' && tokens.length > 0 && !PS_BLOCK_KEYWORDS.has(cmdName(tokens[0]));
      if (psArgument) {
        const close = matchParen(text, i);
        substs.push(text.slice(i + 1, close));
        take(i, close + 1);
        i = close + 1;
        continue;
      }
      flushSeg('(');
      i++;
      continue;
    }
    const standalone = tok === null && (d === undefined || /[\s;]/.test(d));
    if (c === ')' || ((c === '{' || c === '}') && (kind === 'ps' || standalone))) {
      flushSeg(c);
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      flushTok();
      raw += c;
      i++;
      continue;
    }
    take(i, i + 1);
    i++;
  }
  flushSeg(null);
  return segs;
}

function cmdName(t) {
  return t.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase();
}

// Index of the real command word: skips assignments, keywords, and wrappers with their
// options. -1 when the segment runs nothing we judge.
function commandIndex(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const n = cmdName(t);
    if (/^[A-Za-z_]\w*=/.test(t) || KEYWORDS.has(n)) {
      i++;
      continue;
    }
    if (NOT_COMMANDS.has(n)) return -1;
    if (Object.prototype.hasOwnProperty.call(WRAPPERS, n)) {
      const valued = WRAPPERS[n];
      i++;
      while (i < tokens.length && (tokens[i].startsWith('-') || /^[A-Za-z_]\w*=/.test(tokens[i]))) {
        i += valued.includes(tokens[i]) ? 2 : 1;
      }
      if (n === 'timeout' && i < tokens.length) i++; // the duration
      continue;
    }
    return i;
  }
  return -1;
}

// ---- paths --------------------------------------------------------------------------------

function tempRoots() {
  const roots = [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR].filter(Boolean);
  if (!IS_WIN) roots.push('/tmp', '/var/tmp');
  return [...new Set(roots.map((r) => P.resolve(r)))];
}

function relation(child, parent) {
  const rel = P.relative(parent, child);
  if (rel === '') return 'same';
  if (!rel.startsWith('..') && !P.isAbsolute(rel)) return 'inside';
  return 'outside';
}

function envValue(name) {
  if (process.env[name] != null) return process.env[name];
  if (IS_WIN) {
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key) return process.env[key];
  }
  return undefined;
}

const SH_KNOWN = new Set(['HOME', 'TMPDIR', 'TEMP', 'TMP', 'PWD', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);

// Expand what we can know (home, temp, env, the current directory, Git Bash drive paths).
// Returns null when something unknowable is left. After a cd the guard could not follow,
// the current directory is "." so relative-path rules still apply.
function expand(t, base, kind) {
  const home = os.homedir();
  const tmp = os.tmpdir();
  const known = (name) => {
    const up = name.toUpperCase();
    if (up === 'PWD') return base ?? '.';
    if (up === 'HOME') return home;
    if (up === 'TMPDIR' && !envValue('TMPDIR')) return tmp;
    return envValue(name);
  };
  let s = t.replace(/^~(?=$|[\\/])/, () => home);
  s = s.replace(/\$\(\s*pwd\s*\)|`pwd`/gi, () => base ?? '.');
  s = s.replace(/\$\{?env:(\w+)\}?/gi, (m, n) => known(n) ?? m);
  s = s.replace(/%(\w+)%/g, (m, n) => known(n) ?? m);
  // Shell variables are case-sensitive ($TMP is known, $tmp is somebody's local);
  // PowerShell's are not, and there only $HOME and $PWD are known.
  s = s.replace(/\$\{(\w+)\}|\$(\w+)/g, (m, a, b) => {
    const n = a || b;
    if (kind === 'ps') return /^(?:home|pwd)$/i.test(n) ? known(n) : m;
    return SH_KNOWN.has(n) ? known(n) ?? m : m;
  });
  if (/[$`]|%\w+%/.test(s)) return null;
  if (IS_WIN && kind === 'sh') {
    if (/^\/tmp(?=$|\/)/.test(s)) return s.replace(/^\/tmp/, () => tmp);
    const drive = s.match(/^\/([a-zA-Z])(?=$|\/)/);
    if (drive) return `${drive[1].toUpperCase()}:${s.slice(2) || '/'}`;
  }
  return s;
}

const VAR = String.raw`(?:\$\{?[\w:]+\}?|\$\([^)]*\)|%\w+%)`;
const ALL_VARS = new RegExp(String.raw`^(?:${VAR}[\\/]+)+(?:${VAR})?[\\/]*\*?$`);

function isRepo(dir) {
  try {
    return fs.existsSync(P.join(dir, '.git'));
  } catch {
    return false;
  }
}

// Why deleting `target` needs a human, or null. ctx.root is the session's working directory
// (the boundary); ctx.base is where relative paths resolve after any cd (null: unknown).
function deleteRisk(target, ctx, recursive) {
  const raw = String(target).trim();
  if (!raw) return null;
  if (COMPUTED.test(raw)) return recursive ? `${raw} is computed when the command runs` : null;
  let t = expand(raw, ctx.base, ctx.kind);
  if (t == null) {
    // `rm -rf "$DIR/$SUB"` with the variables empty is `rm -rf /`.
    return recursive && ALL_VARS.test(raw) ? `${raw} is made only of variables (empty means a root)` : null;
  }
  const base = P.basename(t);
  const glob = /[*?[]/.test(base);
  const itself = !glob || /^\.?\*$/.test(base); // a bare * empties the directory itself
  if (glob) t = P.dirname(t); // judge the directory the pattern expands in
  if (ctx.base == null && !P.isAbsolute(t)) return recursive ? `${raw} is relative to a directory the guard cannot resolve` : null;
  const abs = P.resolve(ctx.base ?? ctx.root, t);
  const cwd = ctx.root;
  const home = P.resolve(os.homedir());
  const toCwd = relation(abs, cwd);
  if (recursive) {
    if (abs.split(/[\\/]/).includes('.git')) return `${raw} is inside a .git directory`;
    if (itself) {
      if (abs === P.parse(abs).root || relation(abs, home) === 'same') return `${raw} is a drive root or the home directory`;
      if (toCwd === 'same' || relation(cwd, abs) === 'inside') return `${raw} is the working directory or one of its parents`;
      if (isRepo(abs)) return `${raw} is a git repository`;
    }
  }
  if (toCwd !== 'outside') {
    const broad = relation(cwd, home) === 'same' || P.parse(P.resolve(cwd)).root === P.resolve(cwd);
    return recursive && broad ? `the working directory ${cwd} is too broad for a recursive delete` : null;
  }
  for (const r of tempRoots()) {
    const rel = relation(abs, r);
    if (rel === 'inside') return null;
    if (rel === 'same') return recursive && itself ? `${raw} is a whole temp directory` : null;
  }
  return `${raw} is outside the working directory`;
}

// ---- pipelines ----------------------------------------------------------------------------

// The command feeding segs[i] (find, ls, Get-ChildItem) within one statement: through a pipe,
// or, with `block`, from inside a ForEach-Object { } body that uses $_.
function pipelineSource(segs, i, block = false) {
  if (!block && segs[i].sep !== '|') return null;
  let filtered = false;
  for (let k = i - 1; k >= 0; k--) {
    const tk = segs[k].tokens;
    const ix = commandIndex(tk);
    const n = ix >= 0 ? cmdName(tk[ix]) : '';
    if (SOURCES.has(n) || n === 'find') return { tokens: tk.slice(ix), name: n, filtered };
    if (FILTERS.has(n) || (segs[k].sep === '{' && n !== 'remove-item')) filtered = true;
    if (segs[k].sep === null || STATEMENT_SEPS.has(segs[k].sep)) break;
  }
  return { tokens: null, filtered };
}

// Tests that narrow a find to some entries. -type, -size, -perm and friends on their own do
// not: `find . -type f -delete` still empties the tree. Negations and -o void the filter.
const FIND_NARROWING = /^-(?:i?name|i?path|i?wholename|i?regex|[acm](?:time|min)|newer\w*|empty)$/;

function findParts(tokens) {
  const roots = [];
  let k = 1;
  while (k < tokens.length && /^-[HLP]$/.test(tokens[k])) k++;
  for (; k < tokens.length; k++) {
    if (/^[-(!]/.test(tokens[k])) break;
    roots.push(tokens[k]);
  }
  const negatedOrAlt = tokens.some((t) => t === '!' || t === '-not' || t === '-o' || t === '-or');
  const narrowing = tokens.some((t, j) => FIND_NARROWING.test(t) && !/^\.?\*$/.test(tokens[j + 1] || ''));
  const depth0 = tokens.some((t, j) => t === '-maxdepth' && tokens[j + 1] === '0');
  return { roots: roots.length ? roots : ['.'], filtered: narrowing && !negatedOrAlt, depth0 };
}

// Paths a pipeline source lists: find includes its roots, Get-ChildItem/ls list contents.
function sourceTargets(src) {
  if (src.name === 'find') {
    const f = findParts(src.tokens);
    return { targets: f.roots, filtered: src.filtered || f.filtered, recursive: !f.depth0 };
  }
  const args = src.tokens.slice(1);
  const dirs = [];
  let filtered = src.filtered;
  let recursive = false;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (RECURSE_FLAG.test(a) || (src.name === 'ls' && /^-[a-zA-Z]*R/.test(a))) recursive = true;
    else if (/^-(?:filter|include|exclude)$/i.test(a)) {
      filtered = true;
      j++;
    } else if (/^-(?:depth|attributes)$/i.test(a)) j++;
    else if (!a.startsWith('-')) {
      const b = a.replace(/[\\/]+$/, '');
      if (/(?:^|[\\/])\.?\*$/.test(b)) dirs.push(P.dirname(b)); // a bare * (or */, .*) is the whole directory
      else if (/[*?[]/.test(P.basename(a))) {
        filtered = true;
        dirs.push(a);
      } else dirs.push(a);
    }
  }
  const list = dirs.length ? dirs : ['.'];
  return { targets: list.map((d) => (filtered ? d : `${d.replace(/[\\/]+$/, '')}/*`)), filtered, recursive };
}

function sourceRisk(src, ctx, recursiveDelete) {
  const s = sourceTargets(src);
  for (const t of s.targets) {
    const why = deleteRisk(t, ctx, !s.filtered && (recursiveDelete || s.recursive));
    if (why) return why;
  }
  return null;
}

// ---- rules --------------------------------------------------------------------------------

function changeDir(name, tokens, ctx) {
  if (name === 'popd' || name === 'pop-location') return null;
  const rest = tokens.slice(1).filter((a) => !(ctx.kind === 'cmd' && /^\/[a-z]$/i.test(a))); // cmd: cd /d X
  if (rest.includes('-')) return null; // cd - : the previous directory is unknown here
  let arg;
  for (let j = 0; j < rest.length; j++) {
    if (/^-(?:path|literalpath)$/i.test(rest[j])) {
      arg = rest[j + 1];
      break;
    }
    if (!rest[j].startsWith('-')) {
      arg = rest[j];
      break;
    }
  }
  if (arg == null) return name === 'cd' && ctx.kind === 'sh' ? P.resolve(os.homedir()) : ctx.base;
  const t = expand(arg, ctx.base, ctx.kind);
  if (t == null) return null;
  if (ctx.base == null && !P.isAbsolute(t)) return null;
  return P.resolve(ctx.base ?? ctx.root, t);
}

function gitRisk(tokens, ctx) {
  let i = 1;
  let base = ctx.base;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C' && tokens[i + 1] != null) {
      const t = expand(tokens[i + 1], base, ctx.kind);
      base = t == null || base == null ? null : P.resolve(base, t);
    }
    i += ['-C', '-c', '--git-dir', '--work-tree', '--namespace'].includes(tokens[i]) ? 2 : 1;
  }
  const sub = tokens[i];
  const args = tokens.slice(i + 1);
  const has = (...fs) => args.some((a) => fs.includes(a));
  const short = (ch) => args.some((a) => /^-[a-zA-Z]+$/.test(a) && a.includes(ch));
  switch (sub) {
    case 'push':
      if (has('--force', '--mirror', '--delete', '--prune') || short('f') || short('d') || args.some((a) => a.startsWith('--force-with-lease')))
        return 'git push that overwrites or deletes remote history';
      if (args.some((a) => /^\+\S/.test(a) || /^:\S/.test(a))) return 'git push with a force or delete refspec';
      return null;
    case 'reset':
      return has('--hard', '--merge') ? 'git reset that discards work-tree changes' : null;
    case 'clean':
      return (has('--force') || short('f')) && !(has('--dry-run') || short('n')) ? 'git clean deletes untracked files' : null;
    case 'branch':
      return has('-D') || ((has('-d', '--delete') || short('d')) && (has('--force') || short('f'))) ? 'git branch force-delete' : null;
    case 'checkout': {
      if (has('--', '.', '--force') || short('f')) return 'git checkout that discards uncommitted changes';
      const pos = [];
      for (const a of args) {
        if (['-b', '-B', '--orphan'].includes(a)) return null; // creating a branch
        if (!a.startsWith('-')) pos.push(a);
      }
      if (pos.length >= 2) return 'git checkout <rev> <path> overwrites uncommitted changes';
      if (pos.length === 1 && base != null && fs.existsSync(P.resolve(base, pos[0]))) return `git checkout ${pos[0]} discards uncommitted changes to it`;
      return null;
    }
    case 'restore':
      return has('--staged', '-S') && !has('--worktree', '-W') ? null : 'git restore that discards uncommitted changes';
    case 'switch':
      return has('--discard-changes', '--force') || short('f') ? 'git switch that discards uncommitted changes' : null;
    case 'stash':
      return ['drop', 'clear'].includes(args[0]) ? `git stash ${args[0]} loses stashed work` : null;
    case 'worktree':
      return args[0] === 'remove' && (has('--force') || short('f')) ? 'git worktree remove --force discards its changes' : null;
    case 'filter-branch':
    case 'filter-repo':
      return 'git history rewrite';
    case 'reflog':
      return args[0] === 'expire' ? 'git reflog expire removes recovery points' : null;
    case 'update-ref':
      return has('-d') ? 'git update-ref -d deletes a ref' : null;
    case 'gc':
      return args.some((a) => a === '--prune=now') ? 'git gc --prune=now removes recovery points' : null;
    default:
      return null;
  }
}

function deleteCommandRisk(name, tokens, segs, i, ctx) {
  const args = tokens.slice(1);
  const cmdSwitches = ['rd', 'rmdir', 'del', 'erase'].includes(name);
  const recursive = args.some(
    (a) =>
      a === '--recursive' ||
      (name === 'rm' && /^-[a-zA-Z]+$/.test(a) && /[rR]/.test(a)) ||
      RECURSE_FLAG.test(a) ||
      (cmdSwitches && /^\/s$/i.test(a)),
  );
  if ((name === 'rd' || name === 'rmdir') && !recursive) return null; // only removes empty directories
  const targets = [];
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (/^-(?:filter|include|exclude)$/i.test(a)) {
      j++;
      continue;
    }
    if (a.startsWith('-')) continue;
    if (cmdSwitches && /^\/[a-zA-Z](?::\S*)?$/.test(a)) continue;
    targets.push(a);
  }
  const label = recursive ? 'recursive delete' : 'delete';
  const fromPipe = targets.filter((t) => /^\$(?:_|PSItem)(?:\W|$)/i.test(t));
  if (!targets.length || fromPipe.length) {
    const src = pipelineSource(segs, i, fromPipe.length > 0);
    if (src && src.tokens) {
      const why = sourceRisk(src, ctx, recursive);
      if (why) return `${label} fed by ${src.name}: ${why}`;
    } else if (src && recursive) return 'recursive delete of paths from the pipeline';
  }
  for (const t of targets) {
    if (fromPipe.includes(t)) continue;
    const why = deleteRisk(t, ctx, recursive);
    if (why) return `${label}: ${why}`;
  }
  return null;
}

function findRisk(tokens, ctx) {
  const execAt = tokens.findIndex((t) => /^-(?:exec|execdir|ok|okdir)$/.test(t));
  const execRm = execAt >= 0 && cmdName(tokens[execAt + 1] || '') === 'rm';
  if (!tokens.includes('-delete') && !execRm) return null;
  const f = findParts(tokens);
  for (const root of f.roots) {
    const why = deleteRisk(root, ctx, !f.filtered && !f.depth0);
    if (why) return `find deleting: ${why}`;
  }
  return null;
}

function xargsRisk(tokens, segs, i, ctx) {
  const valued = ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--max-args', '--max-procs', '--delimiter', '--arg-file'];
  let j = 1;
  while (j < tokens.length && tokens[j].startsWith('-')) j += valued.includes(tokens[j]) ? 2 : 1;
  if (j >= tokens.length || cmdName(tokens[j]) !== 'rm') return null;
  const recursive = tokens.slice(j + 1).some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive');
  const src = pipelineSource(segs, i);
  if (src && src.tokens) {
    const why = sourceRisk(src, ctx, recursive);
    return why ? `xargs rm fed by ${src.name}: ${why}` : null;
  }
  return recursive ? 'recursive delete of paths read from stdin (xargs rm -r)' : null;
}

const RSYNC_VALUED = new Set(['-e', '--rsh', '-f', '--filter', '--exclude', '--include', '--exclude-from', '--include-from',
  '--files-from', '--backup-dir', '--link-dest', '--compare-dest', '--copy-dest', '--log-file', '--partial-dir',
  '--temp-dir', '--chmod', '--chown', '--port', '--password-file']);

function rsyncRisk(tokens, ctx) {
  if (!tokens.some((t) => /^--(?:delete|remove-source-files)/.test(t))) return null;
  const pos = [];
  for (let j = 1; j < tokens.length; j++) {
    if (RSYNC_VALUED.has(tokens[j])) j++;
    else if (!tokens[j].startsWith('-')) pos.push(tokens[j]);
  }
  const dest = pos[pos.length - 1];
  if (!dest || pos.length < 2) return null;
  if (/^[^\\/]*:/.test(dest) && !/^[a-zA-Z]:[\\/]/.test(dest)) return `rsync --delete into remote ${dest}`;
  const why = deleteRisk(dest.replace(/[\\/]+$/, '') || dest, ctx, true);
  return why ? `rsync --delete: ${why}` : null;
}

function dbRisk(text) {
  for (const [re, why] of DB_RULES) if (re.test(text)) return `database: ${why}`;
  return null;
}

// Commands that run another command line: return it and its dialect.
function nestedScript(name, tokens) {
  if (SHELLS.has(name)) {
    const c = tokens.findIndex((t, k) => k > 0 && /^-[a-zA-Z]*c[a-zA-Z]*$/.test(t));
    if (c < 0) return null;
    const script = tokens[c + 1] === '--' ? tokens[c + 2] : tokens[c + 1];
    return script == null ? null : { script, kind: 'sh' };
  }
  if (PWSH.has(name)) {
    const enc = tokens.findIndex((t, k) => k > 0 && /^-(?:e|ec|enc|encodedcommand)$/i.test(t));
    if (enc > 0 && tokens[enc + 1]) {
      try {
        return { script: Buffer.from(tokens[enc + 1], 'base64').toString('utf16le'), kind: 'ps' };
      } catch {
        return null;
      }
    }
    const c = tokens.findIndex((t, k) => k > 0 && /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(t));
    return c > 0 ? { script: tokens.slice(c + 1).join(' '), kind: 'ps' } : null;
  }
  if (name === 'cmd') {
    const c = tokens.findIndex((t, k) => k > 0 && /^\/\/?[ck]$/i.test(t));
    return c > 0 ? { script: tokens.slice(c + 1).join(' '), kind: 'cmd' } : null;
  }
  if (name === 'eval') return { script: tokens.slice(1).join(' '), kind: 'sh' };
  if (name === 'invoke-expression' || name === 'iex') return { script: tokens.slice(1).join(' '), kind: 'ps' };
  if (['docker', 'podman'].includes(name) && tokens[1] === 'exec') {
    const valued = ['-e', '--env', '-u', '--user', '-w', '--workdir', '--env-file'];
    let j = 2;
    while (j < tokens.length && tokens[j].startsWith('-')) j += valued.includes(tokens[j]) ? 2 : 1;
    return j + 1 < tokens.length ? { script: quoteJoin(tokens.slice(j + 1)), kind: 'sh', remote: true } : null;
  }
  if (name === 'kubectl' && tokens[1] === 'exec') {
    const dd = tokens.indexOf('--');
    return dd > 0 ? { script: quoteJoin(tokens.slice(dd + 1)), kind: 'sh', remote: true } : null;
  }
  return null;
}

// Re-quote tokens so a nested evaluation sees the same words.
function quoteJoin(tokens) {
  return tokens.map((t) => (/[\s;&|()]/.test(t) ? `'${t.replace(/'/g, "'\\''")}'` : t)).join(' ');
}

function segmentRisk(segs, i, ctx) {
  const seg = segs[i];
  for (const inner of seg.substs) {
    const why = ctx.depth < 4 ? evaluate(inner, ctx.root, ctx.kind === 'cmd' ? 'sh' : ctx.kind, ctx.depth + 1, ctx.base) : null;
    if (why) return why;
  }
  const idx = commandIndex(seg.tokens);
  if (idx < 0) return null;
  const tokens = seg.tokens.slice(idx);
  const name = cmdName(tokens[0]);
  const args = tokens.slice(1);
  const words = args.filter((a) => !a.startsWith('-')).map((a) => a.toLowerCase());
  const [sub = '', sub2 = ''] = words;

  if (CD.has(name)) {
    ctx.base = changeDir(name, tokens, ctx);
    return null;
  }
  const nested = ctx.depth < 4 ? nestedScript(name, tokens) : null;
  if (nested) {
    // Inside a container the host paths mean nothing; only the non-path rules apply there.
    const root = nested.remote ? P.resolve(os.tmpdir(), 'lask-guard-remote') : ctx.root;
    return evaluate(nested.script, root, nested.kind, ctx.depth + 1, nested.remote ? root : ctx.base);
  }

  if (name === 'xargs') return xargsRisk(tokens, segs, i, ctx);
  if (DELETERS.has(name)) return deleteCommandRisk(name, tokens, segs, i, ctx);
  if (name === 'find') return findRisk(tokens, ctx);
  if (name === 'rsync') return rsyncRisk(tokens, ctx);
  if (name === 'git') return gitRisk(tokens, ctx);
  if (DB_CLIENTS.has(name)) {
    // The client reads its arguments and whatever is piped into it.
    for (let k = i; k >= 0; k--) {
      const why = dbRisk(segs[k].raw);
      if (why) return why;
      if (segs[k].sep !== '|') break;
    }
    return null;
  }
  if (name === 'dropdb') return 'database: dropdb drops a database';
  if (name === 'mysqladmin' && words.includes('drop')) return 'database: mysqladmin drop';
  if ((name === 'gh' || name === 'glab') && ['repo', 'release'].includes(sub) && sub2 === 'delete') return `${name} ${sub} delete`;
  const dryRun = args.includes('--dry-run');
  if (['npm', 'pnpm', 'yarn'].includes(name) && !dryRun && (['publish', 'unpublish'].includes(sub) || (sub === 'npm' && sub2 === 'publish')))
    return `${name} ${sub} to a public registry`;
  if (name === 'cargo' && ['publish', 'yank'].includes(sub) && !dryRun) return `cargo ${sub} on crates.io`;
  if (name === 'poetry' && sub === 'publish' && !dryRun) return 'poetry publish to a package index';
  if (name === 'twine' && sub === 'upload') return 'twine upload to a package index';
  if (name === 'gem' && sub === 'push') return 'gem push to a registry';
  if (name === 'dotnet' && sub === 'nuget' && sub2 === 'push') return 'dotnet nuget push';
  if (['docker', 'podman', 'helm'].includes(name) && (sub === 'push' || (sub === 'image' && sub2 === 'push'))) return `${name} push to a registry`;
  if (['format-volume', 'clear-disk', 'initialize-disk', 'remove-partition', 'diskpart', 'mkfs'].includes(name) || name.startsWith('mkfs.'))
    return `${name} rewrites a disk`;
  if (name === 'format' && /^[a-z]:$/i.test(args[0] || '')) return `format ${args[0]}`;
  if (name === 'dd' && args.some((t) => /^of=(?:\/dev\/|.*PhysicalDrive)/i.test(t))) return 'dd writes to a raw device';
  if (['shutdown', 'reboot', 'halt', 'poweroff', 'stop-computer', 'restart-computer'].includes(name)) return `${name} powers the machine off`;
  if (name === 'systemctl' && ['poweroff', 'reboot', 'halt', 'kexec'].includes(sub)) return `systemctl ${sub} powers the machine off`;
  return null;
}

// Why `command` needs a human, or null. cwd is the session's working directory.
function evaluate(command, cwd, kind, depth = 0, base = cwd) {
  const { text, dbBodies } = stripHeredocs(String(command), kind);
  for (const body of dbBodies) {
    const why = dbRisk(body);
    if (why) return why;
  }
  const segs = splitCommands(text, kind);
  const ctx = { root: cwd, base, kind, depth };
  const scopes = []; // sh subshells: a cd inside ( ) ends at the )
  for (let i = 0; i < segs.length; i++) {
    if (kind === 'sh') {
      for (const s of segs[i].seps) {
        if (s === '(') scopes.push(ctx.base);
        else if (s === ')' && scopes.length) ctx.base = scopes.pop();
      }
    }
    const why = segmentRisk(segs, i, ctx);
    if (why) return why;
  }
  return null;
}

function main(raw) {
  if (/^(0|off|false)$/i.test(process.env.LASK_GUARD || '')) return;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const input = data && data.tool_input;
  if (!input || typeof input.command !== 'string') return;
  const kind = data.tool_name === 'PowerShell' ? 'ps' : 'sh';
  const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd();
  const why = evaluate(input.command, cwd, kind);
  if (!why) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason:
          `lask guard: ${why}. Destructive or hard to undo — approve only if this is intended. ` +
          '(LASK_GUARD=0 turns the guard off.)',
      },
    }),
  );
}

module.exports = { evaluate, deleteRisk, splitCommands, stripHeredocs };

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    try {
      main(raw);
    } catch {
      /* fail open */
    }
    process.exit(0);
  });
}
