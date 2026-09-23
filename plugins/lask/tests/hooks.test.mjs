// Behavior tests for the 2.1 hooks: destructive-guard (PreToolUse Bash|PowerShell) and
// run-resume (SessionStart compact).
//   node --test plugins/lask/tests/hooks.test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "hooks", "scripts");
const { evaluate } = require(path.join(SCRIPTS, "destructive-guard.js"));

// A working directory that need not exist: under home, never a temp dir, never home itself.
const CWD = path.join(os.homedir(), "lask-guard-fake", "proj");
const OUTSIDE = path.join(os.homedir(), "lask-guard-fake", "other");
const TMP_CHILD = path.join(os.tmpdir(), "lask-guard-scratch");
const sh = (cmd) => evaluate(cmd, CWD, "sh");
const ps = (cmd) => evaluate(cmd, CWD, "ps");
const q = (p) => JSON.stringify(p.replace(/\\/g, "/"));

function runHook(script, input, env = {}) {
  const out = execFileSync(process.execPath, [path.join(SCRIPTS, script)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return out.trim() ? JSON.parse(out) : null;
}

test("guard asks before recursive deletes that escape the working directory", () => {
  for (const cmd of [
    "rm -rf /",
    "rm -rf ~",
    "rm -rf ~/",
    "rm -rf $HOME",
    "rm -rf .",
    "rm -rf ./",
    "rm -rf *",
    "rm -rf ./*",
    "rm -rf ..",
    "rm -rf ../other",
    `rm -rf ${q(OUTSIDE)}`,
    'rm -rf "$BUILD_DIR/"',
    "rm -rf $OUT/*",
    "rm -rf .git",
    "rm -rf .git/objects",
    "sudo rm -fr /var/lib/thing",
    "cd x && rm -r ../../../",
    "find .. | xargs rm -rf",
    "ls | xargs rm -rf",
    "printf x | xargs -I {} rm -rf {}",
  ])
    assert.ok(sh(cmd), `must ask: ${cmd}`);
});

test("guard follows cd, keywords, grouping and wrapper options", () => {
  for (const cmd of [
    "cd .. && rm -rf proj",
    "cd ~ && rm -rf Documents",
    "pushd .. && rm -rf proj",
    "cd - && rm -rf build",
    "cd \"$SOMEWHERE\" && rm -rf build",
    "if [ -d ../x ]; then rm -rf ../x; fi",
    "for f in a b; do rm -rf ../a; done",
    "while false; do git reset --hard; done",
    "(cd sub && git reset --hard)",
    "true || { git push --force; }",
    "! git push --force",
    "timeout 60 git push --force",
    "sudo -u root rm -rf /",
    "doas -u root git push --force",
    "nice -n 10 rm -rf /",
    "env -u X rm -rf /",
    'eval "rm -rf /"',
    'bash -c -- "rm -rf /"',
  ])
    assert.ok(sh(cmd), `must ask: ${cmd}`);
  for (const cmd of [
    "Set-Location ..; Remove-Item -Recurse -Force proj",
    "if ($true) { Remove-Item -Recurse -Force ~ }",
    "Get-ChildItem .. -Recurse | Remove-Item -Force",
    `Get-ChildItem -Path ${OUTSIDE} -Recurse | Remove-Item`,
    "Get-ChildItem | Remove-Item -Recurse -Force",
    `powershell -EncodedCommand ${Buffer.from("Remove-Item -Recurse -Force ~", "utf16le").toString("base64")}`,
  ])
    assert.ok(ps(cmd), `must ask: ${cmd}`);
  for (const cmd of ["cd sub && rm -rf build", "cd build; rm -rf *", "(cd sub && make clean)", "for f in *.log; do rm \"$f\"; done", "sudo -u root ls /"])
    assert.equal(sh(cmd), null, `must not ask: ${cmd}`);
  assert.equal(ps("Get-ChildItem -Recurse | Where-Object { $_.Name -like '*.tmp' } | Remove-Item"), null);
});

test("guard resolves variables whose value it knows, and all-variable paths", () => {
  for (const cmd of ['rm -rf "$PWD"', "rm -rf $PWD/..", "rm -rf $(pwd)", 'rm -rf "$DIR/$SUB"', "rm -rf $A/$B/*"]) assert.ok(sh(cmd), `must ask: ${cmd}`);
  assert.ok(ps("Remove-Item -Recurse -Force ${env:USERPROFILE}"));
  assert.ok(ps("Remove-Item -Recurse -Force $env:APPDATA\\lask-x"), "APPDATA is outside the working directory");
  assert.equal(sh('rm -rf "$PWD/build"'), null);
  assert.equal(sh('rm -rf "$DIR/build"'), null, "unknowable but not all-variable: not our call");
});

test("guard lets routine deletes inside the working directory or temp through", () => {
  for (const cmd of [
    "rm -rf node_modules",
    "rm -rf ./build/",
    "rm -rf target/debug dist",
    "rm -rf *.log",
    "rm -f .git/index.lock",
    "rm file.txt",
    `rm -rf ${q(TMP_CHILD)}`,
    "rm -rf $TMPDIR/lask-x",
    'rm -rf "$tmp"',
    "rmdir ../empty-dir",
    "find . -name '*.pyc' -delete",
    "ls -la && echo done",
  ])
    assert.equal(sh(cmd), null, `must not ask: ${cmd}`);
});

test("guard asks before plain deletes outside the working directory", () => {
  assert.ok(sh(`rm ${q(path.join(OUTSIDE, "notes.txt"))}`));
  assert.ok(sh("rm ~/.bashrc"));
  assert.ok(sh("find / -name core -delete"));
});

test("guard reads PowerShell and cmd deletes", () => {
  assert.ok(ps(`Remove-Item -Recurse -Force ${q(OUTSIDE)}`));
  assert.ok(ps("Remove-Item -Path . -Recurse -Force"));
  assert.ok(ps("rm -r -fo $env:USERPROFILE"));
  assert.ok(ps('Remove-Item "$dir\\*" -Recurse'));
  assert.ok(ps("Get-ChildItem C:\\ | Remove-Item -Recurse -Force"), "pipeline-fed recursive delete");
  assert.ok(sh(`cmd /c "rd /s /q ${OUTSIDE}"`));
  assert.equal(ps("Remove-Item -Recurse -Force .\\bin"), null);
  assert.equal(ps("Remove-Item -Recurse -Force $env:TEMP\\lask-x"), null);
  assert.equal(ps("Get-ChildItem -Filter *.tmp | Remove-Item"), null);
  assert.equal(ps("rmdir .\\empty"), null);
});

test("guard follows commands nested in bash -c / pwsh -Command", () => {
  assert.ok(sh(`bash -c "rm -rf ${OUTSIDE.replace(/\\/g, "/")}"`));
  assert.ok(sh("sh -lc 'git push --force origin main'"));
  assert.ok(sh(`powershell -NoProfile -Command "Remove-Item -Recurse -Force ~"`));
  assert.equal(sh("bash -c 'cargo test'"), null);
});

test("guard asks before destroying git history or uncommitted work", () => {
  for (const cmd of [
    "git push --force",
    "git push -f origin main",
    "git push origin +main",
    "git push --force-with-lease origin feat",
    "git push origin --delete old-branch",
    "git push origin :old-branch",
    "git -C ../other push --force",
    "git reset --hard HEAD~3",
    "git clean -fdx",
    "git branch -D feature",
    "git checkout -- src/app.ts",
    "git checkout .",
    "git restore src/app.ts",
    "git stash drop",
    "git stash clear",
    "git filter-branch --tree-filter x HEAD",
    "git reflog expire --expire=now --all",
    "git checkout HEAD~1 src/app.ts",
    "git switch -f main",
    "git switch --discard-changes main",
    "git push --prune origin",
    "git worktree remove --force ../wt",
  ])
    assert.ok(sh(cmd), `must ask: ${cmd}`);
  for (const cmd of [
    "git push",
    "git push -u origin feat",
    "git status",
    "git reset --soft HEAD~1",
    "git reset HEAD file",
    "git clean -n",
    "git branch -d merged",
    "git checkout -b new",
    "git checkout -b feat origin/feat",
    "git checkout main",
    "git switch main",
    "git worktree remove ../wt",
    "git restore --staged file",
    "git stash pop",
    'git commit -m "never git push --force here"',
  ])
    assert.equal(sh(cmd), null, `must not ask: ${cmd}`);
});

test("git checkout <file> asks only when the argument is a path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-checkout-"));
  try {
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "app.ts"), "x");
    assert.ok(evaluate("git checkout src/app.ts", dir, "sh"));
    assert.ok(evaluate("git checkout src", dir, "sh"));
    assert.equal(evaluate("git checkout main", dir, "sh"), null);
    assert.ok(evaluate("cd src && git checkout app.ts", dir, "sh"), "existence follows cd");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("guard asks before destructive SQL sent through a database client", () => {
  assert.ok(sh('psql -c "DROP TABLE users"'));
  assert.ok(sh("sqlcmd -S 127.0.0.1,14330 -Q \"TRUNCATE TABLE char_inv\""));
  assert.ok(sh('sqlite3 app.db "DELETE FROM sessions;"'));
  assert.ok(sh("psql <<'SQL'\nDROP DATABASE game;\nSQL"));
  assert.ok(ps('Invoke-Sqlcmd -Query "DROP TABLE t"'));
  assert.equal(sh('sqlite3 app.db "DELETE FROM sessions WHERE expired = 1;"'), null);
  assert.equal(sh("cat > migrate.sql <<'EOF'\nDROP TABLE old;\nEOF"), null, "writing SQL to a file is not running it");
  assert.equal(sh('echo "DROP TABLE x" > note.txt'), null);
  assert.ok(sh(`psql -c 'DELETE FROM "sessions";'`), "quoted identifier");
  assert.ok(sh("cat <<'EOF' | psql\nTRUNCATE users;\nEOF"), "heredoc piped into a client");
  assert.ok(sh("dropdb production"));
  assert.ok(sh("mysqladmin -u root drop shop"));
  assert.ok(sh('mongosh --eval "db.dropDatabase()"'));
  for (const cmd of [
    'git commit -m "psql: revert the DROP TABLE users change"',
    'grep -rn "DELETE FROM sessions" src/db/mysql/',
    "cat > scripts/reset.sh <<'EOF'\npsql -c \"DROP TABLE users\"\nEOF",
    "psql <<'SQL'\nDELETE FROM sessions\nWHERE expired;\nSQL",
    'psql -c "DELETE FROM t\nWHERE id = 1;"',
  ])
    assert.equal(sh(cmd), null, `must not ask: ${cmd}`);
});

test("guard asks before disk, power and publish commands", () => {
  for (const cmd of [
    "npm publish",
    "npm unpublish x",
    "pnpm -r publish",
    "cargo publish",
    "poetry publish",
    "gem push x.gem",
    "docker push img:1",
    "gh repo delete me/x --yes",
    "gh release delete v1",
    "shutdown /s /t 0",
    "dd if=x of=/dev/sda",
    "dd if=x of='\\\\.\\PhysicalDrive1'",
    "mkfs.ext4 /dev/sdb1",
    `rsync -a --delete src/ ${q(OUTSIDE)}/`,
    "rsync -a --delete src/ ./",
    "rsync -a --delete src/ host:/srv/app/",
  ])
    assert.ok(sh(cmd), `must ask: ${cmd}`);
  assert.ok(ps("Format-Volume -DriveLetter D"));
  assert.ok(ps("Remove-Partition -DiskNumber 1 -PartitionNumber 2"));
  assert.equal(sh("rsync -a --delete src/ dist/"), null);
  assert.equal(sh("find build -name '*.o' -delete"), null);
  assert.ok(sh("find . -delete"));
  assert.ok(sh("find . -exec rm -rf {} +"));
  assert.equal(sh("find . -name '*.o' | xargs rm -rf"), null, "filtered find inside the working directory");
  assert.equal(sh("npm install"), null);
  assert.equal(sh("gh pr view 12"), null);
});

test("heredoc bodies are data unless a shell runs them", () => {
  assert.equal(sh("cat > clean.sh <<'EOF'\nrm -rf /\nEOF"), null);
  assert.ok(sh("bash <<'EOF'\nrm -rf /\nEOF"));
  assert.ok(sh("cat <<'EOF' | sh\nrm -rf /\nEOF"), "a body piped into a shell runs");
  assert.ok(sh("grep foo <<< bar\nrm -rf /"), "<<< is a here-string, not a heredoc");
  assert.equal(sh("cat <<EOF > x.txt\n  EOF\nrm -rf /\nEOF"), null, "an indented delimiter does not end a << heredoc");
  assert.ok(sh("cat <<-EOF > x.txt\n\tEOF\nrm -rf /"), "<<- ends at a tab-indented delimiter");
  assert.equal(ps("$s = @'\nRemove-Item -Recurse -Force C:\\\n'@\n$s | Out-File x.txt"), null);
});

test("round 2: substitutions, subshell scope, PowerShell arguments and pipelines", () => {
  for (const cmd of [
    "out=$(git push --force 2>&1)",
    "echo `rm -rf /`",
    'echo "$(rm -rf /)"',
    "(rm -rf ../x)",
    "(git push --force)",
    "(cd sub && make) ; rm -rf ../other",
    'cd "$X" && rm -rf "$PWD"',
    'rm -rf "$(git rev-parse --show-toplevel)"',
    "find . -type f -delete",
    "find . ! -name keep -delete",
    "find . -name '*' -delete",
    "find . -type f | xargs rm -f",
    "find . -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} +",
    "ls -d */ | xargs rm -rf",
    'echo "DROP TABLE users;" | psql mydb',
    "printf 'TRUNCATE t;' | mysql shop",
    "cd sub && bash <<'EOF'\nrm -rf /\nEOF",
    "set -e; sh <<'EOF'\ngit push --force\nEOF",
    'git commit -m "fix <<EOF parsing"\nrm -rf /',
    "rsync -a --delete src/ ../prod/ --exclude build",
    "systemctl poweroff",
    "docker image push img:1",
    "yarn npm publish",
    'mysql -e "DELETE FROM users LIMIT 1000"',
    'mongosh app --eval "db.users.drop()"',
    'docker exec pg psql -c "DROP TABLE users"',
  ])
    assert.ok(sh(cmd), `must ask: ${cmd}`);
  for (const cmd of [
    "Remove-Item -Recurse -Force $home",
    "Remove-Item -Recurse -Force $PWD\\..\\other",
    "Remove-Item -Recurse -Force (Get-Location)",
    "Remove-Item -Recurse -Force (Join-Path $env:USERPROFILE 'Documents')",
    "Get-ChildItem * | Remove-Item -Recurse -Force",
    "Get-ChildItem C:\\ | % { Remove-Item $_ -Recurse -Force }",
    "gci .. | ForEach-Object { Remove-Item $_.FullName -Recurse -Force }",
  ])
    assert.ok(ps(cmd), `must ask: ${cmd}`);
  for (const cmd of [
    "(cd sub && make clean)",
    "cat > db/psql-notes.md <<'EOF'\nWe never DROP TABLE users here.\nEOF",
    "cat <<\\EOF > x.sh\nrm -rf /\nEOF",
    "echo $((1<<4))",
    "npm publish --dry-run",
    "find . -name '*.pyc' -delete",
    "find . -empty -delete",
  ])
    assert.equal(sh(cmd), null, `must not ask: ${cmd}`);
  assert.equal(ps("Get-ChildItem -Recurse -Filter *.tmp | ForEach-Object { Remove-Item $_.FullName }"), null);
  assert.equal(evaluate(`cd /d ${CWD} && rd /s /q build`, CWD, "cmd"), null, "cmd cd /d takes the next word as the path");
});

test("git -C moves the base for checkout's path test", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-gitc-"));
  try {
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "app.ts"), "x");
    assert.ok(evaluate("git -C sub checkout app.ts", dir, "sh"));
    assert.equal(evaluate("git checkout app.ts", dir, "sh"), null, "no such path at the base: a branch name");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Git Bash drive paths and /tmp resolve like Windows paths", { skip: process.platform !== "win32" && "Windows only" }, () => {
  const drive = CWD.replace(/^([A-Za-z]):\\/, (m, d) => `/${d.toLowerCase()}/`).replace(/\\/g, "/");
  assert.equal(sh(`rm -rf ${drive}/node_modules`), null);
  assert.ok(sh(`rm -rf ${drive}`));
  assert.equal(sh("rm -rf /tmp/lask-x"), null);
  assert.ok(sh("rm -rf /tmp"));
  assert.ok(sh("rm -rf /c/Windows/Temp/../System32"));
});

test("guard hook speaks the PreToolUse protocol: ask, never deny, off switch, fail-open", () => {
  const out = runHook("destructive-guard.js", { tool_name: "Bash", cwd: CWD, tool_input: { command: "git push --force" } });
  assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /lask guard: .*LASK_GUARD=0/);
  const psOut = runHook("destructive-guard.js", { tool_name: "PowerShell", cwd: CWD, tool_input: { command: "Remove-Item -Recurse -Force ~" } });
  assert.equal(psOut.hookSpecificOutput.permissionDecision, "ask");
  assert.equal(runHook("destructive-guard.js", { tool_name: "Bash", cwd: CWD, tool_input: { command: "ls" } }), null);
  assert.equal(runHook("destructive-guard.js", { tool_name: "Bash", cwd: CWD, tool_input: { command: "git push -f" } }, { LASK_GUARD: "0" }), null);
  assert.equal(runHook("destructive-guard.js", "not json"), null);
  assert.equal(runHook("destructive-guard.js", { tool_name: "Bash", tool_input: {} }), null);
});

test("run-resume points at TASKS.md after compaction, and only when work is open", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-resume-"));
  try {
    const input = { hook_event_name: "SessionStart", source: "compact", cwd: dir };
    assert.equal(runHook("run-resume.js", input), null, "no TASKS.md: silent");
    fs.writeFileSync(path.join(dir, "TASKS.md"), "# t\nDone means: x\n- [x] one\n- [X] two\n");
    assert.equal(runHook("run-resume.js", input), null, "nothing open: silent");
    fs.writeFileSync(path.join(dir, "TASKS.md"), "# roadmap\n- [ ] someday\n");
    assert.equal(runHook("run-resume.js", input), null, "a project's own TASKS.md without the long-run contract: silent");
    fs.writeFileSync(path.join(dir, "TASKS.md"), "# t\nDone means: x\n```\n- [ ] example in a fence\n```\n- [x] one\n");
    assert.equal(runHook("run-resume.js", input), null, "fenced checkboxes are not open work");
    fs.writeFileSync(path.join(dir, "TASKS.md"), "# t\nDone means: tests pass\n- [x] one\n- [ ] two\n  - [ ] three\n");
    const out = runHook("run-resume.js", input);
    assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
    assert.match(out.hookSpecificOutput.additionalContext, /TASKS\.md \(2 open, 1 done\)/);
    assert.ok(out.hookSpecificOutput.additionalContext.length < 400, "a pointer, not a policy");
    fs.mkdirSync(path.join(dir, ".git"));
    fs.mkdirSync(path.join(dir, "sub", "deeper"), { recursive: true });
    const nested = runHook("run-resume.js", { ...input, cwd: path.join(dir, "sub", "deeper") });
    assert.match(nested.hookSpecificOutput.additionalContext, /2 open/, "found at the repository root from a subdirectory");
    fs.writeFileSync(path.join(dir, "sub", "TASKS.md"), "# package roadmap\n- [ ] later\n");
    const past = runHook("run-resume.js", { ...input, cwd: path.join(dir, "sub") });
    assert.match(past.hookSpecificOutput.additionalContext, /2 open/, "a nearer TASKS.md without the contract does not hide the root one");
    fs.writeFileSync(path.join(dir, "TASKS.md"), "# t\n**Done means:** tests pass\n- [ ] one\n");
    assert.match(runHook("run-resume.js", input).hookSpecificOutput.additionalContext, /1 open/, "bold Done means: counts");
    assert.equal(runHook("run-resume.js", "{bad"), null, "fail-open");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
