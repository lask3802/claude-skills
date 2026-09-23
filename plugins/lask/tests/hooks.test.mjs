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
    // Work-tree commands where the state cannot be read (CWD is not a repository) still ask.
    "git reset --hard HEAD~3",
    "git clean -fdx",
    "git checkout -- src/app.ts",
    "git checkout .",
    "git restore src/app.ts",
    "git filter-branch --tree-filter x HEAD",
    "git reflog expire --expire=now --all",
    "git gc --prune=now",
    "git checkout HEAD~1 src/app.ts",
    "git switch -f main",
    "git switch --discard-changes main",
    "git push --prune origin",
    "git worktree remove --force ../wt",
    "git checkout main", // without a repository the guard cannot tell a branch from a path
    "git prune",
    "git reflog delete HEAD@{1}",
    "git gc --prune=all",
    "git checkout --pathspec-from-file=list.txt",
    "git restore --pathspec-from-file=list.txt",
    "git checkout -b feat origin/feat", // the start point's tree cannot be read either
    "git switch main", // nor whether main tracks a file that is ignored here
  ])
    assert.ok(sh(cmd), `must ask: ${cmd}`);
  for (const cmd of [
    "git branch -D feature",
    "git stash drop",
    "git stash clear",
    "git push",
    "git push -u origin feat",
    "git status",
    "git reset --soft HEAD~1",
    "git reset HEAD file",
    "git clean -n",
    "git branch -d merged",
    "git checkout -b new",
    "git switch -c new",
    "git prune -n",
    "git gc",
    "git worktree remove ../wt",
    "git restore --staged file",
    "git stash pop",
    'git commit -m "never git push --force here"',
  ])
    assert.equal(sh(cmd), null, `must not ask: ${cmd}`);
});

test("local git commands ask only when git status says uncommitted work would be lost", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lask-gitstate-"));
  const git = (dir, ...args) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  try {
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    git(root, "init", "-q", "-b", "main", repo);
    fs.writeFileSync(path.join(repo, "src", "app.ts"), "one\n");
    fs.writeFileSync(path.join(repo, "src", "lib.ts"), "one\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "branch", "feat");
    const wt = path.join(root, "wt-scratch");
    git(repo, "worktree", "add", "-q", wt, "feat");
    const at = (cmd, dir = repo) => evaluate(cmd, dir, "sh");
    const LOCAL = [
      "git reset --hard HEAD~0",
      "git checkout -- .",
      "git checkout .",
      "git checkout -f",
      "git checkout HEAD -- src/app.ts",
      "git restore src/app.ts",
      "git restore --source=HEAD -W -S src",
      "git switch -f feat",
      "git -c core.longpaths=true checkout -- . 2>&1 | tail -2",
    ];

    // Clean tree: nothing to lose, nothing asks.
    for (const cmd of [...LOCAL, "git clean -fd", "git clean -fdx", `git worktree remove --force ${q(wt)}`, "git worktree remove -f wt-scratch"])
      assert.equal(at(cmd), null, `clean tree must not ask: ${cmd}`);

    // Redirections are not paths: a plain branch switch never asks (the 2.1 false positive).
    assert.equal(at("git checkout main > /dev/null"), null);
    assert.equal(at("git -c core.longpaths=true checkout -q feat 2>&1 | tail -2"), null);

    // A tracked edit: every command that would overwrite it asks; ones that do not touch it pass.
    fs.writeFileSync(path.join(repo, "src", "app.ts"), "two\n");
    for (const cmd of LOCAL) assert.ok(at(cmd), `dirty tree must ask: ${cmd}`);
    assert.equal(at("git checkout HEAD -- src/lib.ts"), null, "an unmodified path loses nothing");
    assert.equal(at("git restore src/lib.ts"), null, "an unmodified path loses nothing");
    assert.equal(at("git clean -fd"), null, "no untracked files: clean deletes nothing");
    assert.equal(at("git checkout feat"), null, "a branch switch is refused by git itself when it would overwrite");
    assert.ok(at("cd src && git checkout app.ts"), "cd is followed for the path and the status check");
    git(repo, "checkout", "--", ".");

    // Untracked files: git clean asks with a count; a dirty worktree asks before removal.
    fs.writeFileSync(path.join(repo, "src", "new.ts"), "x\n");
    assert.match(at("git clean -fd") ?? "", /deletes 1 untracked/);
    assert.equal(at("git clean -fd -e new.ts"), null, "the dry run carries the same flags");
    assert.equal(at("git reset --hard"), null, "reset --hard leaves untracked files alone");
    fs.writeFileSync(path.join(wt, "scratch.txt"), "x\n");
    assert.ok(at(`git worktree remove --force ${q(wt)}`), "untracked files in the worktree would be lost");
    assert.ok(at("git worktree remove -f wt-scratch"), "a worktree named by its last path component is found");
    assert.ok(at(`git worktree remove --force ${q(path.join(root, "gone"))}`), "a worktree git may resolve differently asks");

    // Recovery points and remote history always ask, whatever the state.
    for (const cmd of ["git reflog expire --expire=now --all", "git gc --prune=now", "git push --force", "git filter-branch x"])
      assert.ok(at(cmd), `must always ask: ${cmd}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("every form that lost data in the 2.2 draft review asks; clean variants still pass", () => {
  // Each "must ask" line below was a false allow in the draft, confirmed by running the real
  // command in a scratch repository and losing the file.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lask-gitrev-"));
  const git = (dir, ...args) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  const write = (p, text = "x\n") => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  try {
    const repo = path.join(root, "repo");
    git(root, "init", "-q", "-b", "main", repo);
    for (const f of ["a.ts", "b.ts", "src/app.ts", "docs/readme.md", "scratch/keep.md", ".gitignore"])
      write(path.join(repo, f), f === ".gitignore" ? "*.log\n" : "x\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "branch", "docs"); // a branch that shares its name with a directory
    git(repo, "checkout", "-q", "-b", "other");
    write(path.join(repo, "new.ts"), "theirs\n");
    git(repo, "add", "new.ts");
    git(repo, "commit", "-q", "-m", "other adds new.ts");
    git(repo, "checkout", "-q", "main");
    const at = (cmd, kind = "sh", dir = repo) => evaluate(cmd, dir, kind);
    const dirty = () => write(path.join(repo, "a.ts"), "mine\n");
    const restore = () => git(repo, "checkout", "--", ".");

    // Branch or path is git's call, not the file system's.
    assert.equal(at("git checkout main"), null, "a branch");
    assert.equal(at("git checkout docs"), null, "a branch that is also a directory: git picks the branch");
    assert.equal(at("git checkout src/app.ts"), null, "a clean path");
    assert.ok(at('cd "$X" && git checkout a.ts'), "an unknown cd target cannot be read");
    assert.ok(at("git checkout a.ts", "sh", root), "outside a repository nothing can be read");

    dirty();
    assert.ok(at("git checkout a.ts"), "a dirty path");
    assert.ok(at("cd src && git checkout ../a.ts"), "cd is followed");
    assert.ok(at("git -C repo checkout a.ts", "sh", root), "-C is followed");
    // Finding 3: two bare paths; the first is not a revision, so both are paths.
    assert.ok(at("git checkout a.ts b.ts"));
    assert.equal(at("git checkout b.ts"), null);
    // Finding 4: -f is checked before branch creation and before the path guess.
    for (const cmd of ["git checkout -f -B main HEAD", "git checkout -f -b new2", "git checkout -f docs"]) assert.ok(at(cmd), `must ask: ${cmd}`);
    assert.equal(at("git checkout -b new3"), null, "a plain branch creation carries the change over");
    // Finding 2: words the shell expands are not literal pathspecs.
    for (const [cmd, kind] of [
      ["git checkout -- $(git diff --name-only)", "sh"],
      ['f=a.ts; git restore "$f"', "sh"],
      ['for f in $(git diff --name-only); do git checkout -- "$f"; done', "sh"],
      ['$file="a.ts"; git checkout -- $file', "ps"],
      ["git checkout -- ~/lask-no-such-dir/a.ts", "sh"],
      ["git checkout -- a.ts>/dev/null", "sh"],
    ])
      assert.ok(at(cmd, kind), `must ask: ${cmd}`);
    restore();
    assert.equal(at('f=b.ts; git restore "$f"'), null, "a variable set earlier in the command resolves");
    write(path.join(repo, "docs", "tmp.md"));
    assert.ok(at('D=docs; git clean -fd "$D"'), "clean on a variable path sees the untracked file");
    fs.rmSync(path.join(repo, "docs", "tmp.md"));
    assert.equal(at('D=docs; git clean -fd "$D"'), null);

    // Finding 5: an untracked file that the target revision would write over.
    write(path.join(repo, "new.ts"), "mine\n");
    for (const cmd of ["git reset --hard other", "git checkout -f other", "git switch -f other", "git checkout other -- new.ts",
      "git restore --source=other new.ts", "git restore -s other new.ts"])
      assert.ok(at(cmd), `must ask: ${cmd}`);
    assert.equal(at("git reset --hard"), null, "HEAD has no new.ts: the untracked file survives");
    assert.equal(at("git checkout other"), null, "without -f git refuses to overwrite it");
    fs.rmSync(path.join(repo, "new.ts"));

    // Finding 1: clean runs the dry run with the same flags, -ff and -d/-x included.
    const nested = path.join(repo, "nested");
    git(root, "init", "-q", nested);
    write(path.join(nested, "wip.txt"));
    assert.equal(at("git clean -fdx"), null, "one -f skips a nested repository");
    assert.match(at("git clean -ffdx") ?? "", /deletes 1 untracked/, "-ff deletes it");
    write(path.join(repo, "a.log"));
    assert.equal(at("git clean -f"), null, "ignored files survive without -x");
    assert.ok(at("git clean -fx"), "-x deletes ignored files");
    fs.rmSync(path.join(repo, "a.log"));
    write(path.join(repo, "build", "out.bin"));
    assert.equal(at("git clean -f"), null, "untracked directories survive without -d");
    assert.ok(at("git clean -fd"), "-d deletes them");
    fs.rmSync(path.join(repo, "build"), { recursive: true });

    // Finding 6: git pointed at another repository.
    const other = path.join(root, "o");
    git(root, "init", "-q", "-b", "main", other);
    write(path.join(other, "o.ts"));
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "o");
    write(path.join(other, "o.ts"), "dirty\n");
    const od = other.replace(/\\/g, "/");
    assert.equal(at("git reset --hard"), null, "control: this repository is clean");
    for (const [cmd, kind] of [
      [`git --git-dir=${od}/.git --work-tree=${od} reset --hard`, "sh"],
      [`git --git-dir ${od}/.git --work-tree ${od} reset --hard`, "sh"],
      [`GIT_DIR=${od}/.git GIT_WORK_TREE=${od} git reset --hard`, "sh"],
      [`export GIT_DIR=${od}/.git; git reset --hard`, "sh"],
      [`$env:GIT_DIR="${od}/.git"; git reset --hard`, "ps"],
    ])
      assert.ok(at(cmd, kind), `must ask: ${cmd}`);

    // Finding 7: worktrees resolve the way git resolves them.
    const wtA = path.join(root, "aaa", "wt");
    const wtB = path.join(root, "bbb", "wt");
    const wtS = path.join(root, "x", "scratch");
    git(repo, "worktree", "add", "-q", "-b", "wa", wtA);
    git(repo, "worktree", "add", "-q", "-b", "wb", wtB);
    git(repo, "worktree", "add", "-q", "-b", "ws", wtS);
    write(path.join(wtB, "wip.txt"));
    write(path.join(wtS, "wip.txt"));
    assert.ok(at("git worktree remove -f bbb/wt"), "a unique trailing suffix picks the dirty one");
    assert.equal(at("git worktree remove -f aaa/wt"), null);
    assert.ok(at("git worktree remove -f wt"), "an ambiguous suffix cannot be resolved");
    assert.ok(at("git worktree remove -f scratch"), "the suffix match wins over the tracked scratch/ directory");
    if (process.platform === "win32") assert.ok(at("git worktree remove -f BBB/WT"), "names match case-insensitively on Windows");
    assert.ok(at(`W=${wtA.replace(/\\/g, "/")}; git worktree remove --force "$W"`), "an unresolvable target with other dirty worktrees asks");
    fs.rmSync(path.join(wtB, "wip.txt"));
    fs.rmSync(path.join(wtS, "wip.txt"));
    assert.equal(at(`W=${wtA.replace(/\\/g, "/")}; git worktree remove --force "$W"`), null, "every linked worktree clean: whichever git picks loses nothing");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("second review: rewritten words widen the check, and anything in a revision's way asks", () => {
  // Each "must ask" line lost data in the second draft (confirmed by running it for real).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lask-gitrev2-"));
  const git = (dir, ...args) =>
    execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  const write = (p, text = "x\n") => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  };
  const mkrepo = (name) => {
    const r = path.join(root, name);
    git(root, "init", "-q", "-b", "main", r);
    return r;
  };
  const commitAll = (r, msg) => {
    git(r, "add", "-A");
    git(r, "commit", "-q", "-m", msg);
  };
  try {
    const r = mkrepo("r");
    write(path.join(r, "a.ts"));
    write(path.join(r, "b.ts"));
    commitAll(r, "i");
    git(r, "checkout", "-q", "-b", "other");
    write(path.join(r, "new.ts"), "theirs\n");
    commitAll(r, "o");
    git(r, "checkout", "-q", "main");
    const at = (cmd, dir = r) => evaluate(cmd, dir, "sh");

    // Words the shell rewrites (variables, loops, branches, subshells, splitting, home,
    // braces) never narrow the check: with a.ts dirty, all of these ask.
    write(path.join(r, "a.ts"), "mine\n");
    for (const cmd of [
      'f=b.ts; for f in $(git diff --name-only); do git checkout -- "$f"; done',
      'if [ -f a.ts ]; then F=a.ts; else F=b.ts; fi; git checkout -- "$F"',
      'F=a.ts; (F=b.ts); git checkout -- "$F"',
      'F=a.ts; true || F=b.ts; git checkout -- "$F"',
      'F="a.ts b.ts"; git checkout -- $F',
      'F=~/x/a.ts; git checkout -- "$F"',
      "git checkout -- {a,b}.ts",
      "git restore {a,b}.ts",
    ])
      assert.ok(at(cmd), `must ask: ${cmd}`);
    assert.equal(at("git checkout -- b.ts"), null, "a plain clean path still narrows the check");
    git(r, "checkout", "--", ".");
    write(path.join(r, "build", "wip.txt"));
    assert.ok(at("git clean -fd {build,dist}"), "a brace word widens clean to the whole tree");
    assert.ok(at('D=~/nowhere/build; git clean -fd "$D"'));
    fs.rmSync(path.join(r, "build"), { recursive: true });
    assert.equal(at("git clean -fd {build,dist}"), null, "nothing untracked anywhere: nothing to lose");

    // Globs (ls-tree does not glob) and clustered short options.
    write(path.join(r, "new.ts"), "mine\n");
    for (const cmd of ["git checkout other -- *.ts", "git restore --source=other *.ts", "git restore -sother new.ts",
      "git checkout -fB main other", "git switch -fC x other"])
      assert.ok(at(cmd), `must ask: ${cmd}`);
    if (process.platform === "win32" || process.platform === "darwin") {
      fs.rmSync(path.join(r, "new.ts"));
      write(path.join(r, "New.ts"), "mine\n");
      assert.ok(at("git reset --hard other"), "New.ts is the same file as new.ts on a case-folding disk");
      fs.rmSync(path.join(r, "New.ts"));
    } else fs.rmSync(path.join(r, "new.ts"));

    // assume-unchanged edits are invisible to git status.
    write(path.join(r, "cfg.json"), "{}\n");
    commitAll(r, "cfg");
    git(r, "update-index", "--assume-unchanged", "cfg.json");
    write(path.join(r, "cfg.json"), '{"local":1}\n');
    assert.ok(at("git reset --hard"), "an assume-unchanged edit");
    assert.ok(at("git checkout -- cfg.json"));
    git(r, "update-index", "--no-assume-unchanged", "cfg.json");
    git(r, "checkout", "--", "cfg.json");
    assert.equal(at("git reset --hard"), null, "control: nothing hidden any more");

    // Wrappers that change directory run git somewhere else.
    const o = mkrepo("o");
    write(path.join(o, "o.ts"));
    commitAll(o, "o");
    write(path.join(o, "o.ts"), "dirty\n");
    assert.ok(at(`env -C ${q(o)} git reset --hard`));
    assert.ok(at(`sudo -D ${q(o)} git reset --hard`));

    // An ignored file that an older revision tracks: every way of writing that revision asks,
    // plain switches included (git overwrites ignored files without a word).
    const e = mkrepo("env");
    write(path.join(e, ".env"), "C\n");
    write(path.join(e, "keep.ts"));
    commitAll(e, "with env");
    git(e, "rm", "-q", "--cached", ".env");
    write(path.join(e, ".gitignore"), ".env\n");
    commitAll(e, "ignore env");
    write(path.join(e, ".env"), "SECRET\n");
    assert.equal(at("git reset --hard", e), null, "control: HEAD does not track .env");
    for (const cmd of ["git reset --hard HEAD~1", "git checkout -f HEAD~1", "git switch -f --detach HEAD~1", "git checkout HEAD~1 -- .env",
      "git restore --source=HEAD~1 .env", "git checkout HEAD~1", "git switch --detach HEAD~1", "git checkout -b old HEAD~1"])
      assert.ok(at(cmd, e), `must ask: ${cmd}`);

    // A file where the revision has a directory, and a directory where it has a file.
    const d = mkrepo("swap");
    write(path.join(d, "keep.ts"));
    commitAll(d, "base");
    git(d, "checkout", "-q", "-b", "shapes");
    write(path.join(d, "build", "out.js"));
    write(path.join(d, "notes"), "a file\n");
    commitAll(d, "shapes");
    git(d, "checkout", "-q", "main");
    assert.equal(at("git reset --hard shapes", d), null, "control: nothing in the way");
    write(path.join(d, "build"), "untracked file\n");
    assert.ok(at("git reset --hard shapes", d), "an untracked file where the revision has a directory");
    fs.rmSync(path.join(d, "build"));
    write(path.join(d, "notes", "a.md"), "untracked\n");
    assert.ok(at("git reset --hard shapes", d), "an untracked directory where the revision has a file");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
    for (const line of ["**Done means:** tests pass", "**Done means**: tests pass", "# Done means: tests pass", "## **Done means**: x", "- Done means: x"]) {
      fs.writeFileSync(path.join(dir, "TASKS.md"), `# t\n${line}\n- [ ] one\n`);
      const hit = runHook("run-resume.js", input);
      assert.match(hit?.hookSpecificOutput.additionalContext ?? "", /1 open/, `the contract line may be written as: ${line}`);
    }
    fs.writeFileSync(path.join(dir, "TASKS.md"), "# t\nWhat Done means for us is unclear\n- [ ] one\n");
    assert.equal(runHook("run-resume.js", input), null, "the phrase inside a sentence is not the contract line");
    assert.equal(runHook("run-resume.js", "{bad"), null, "fail-open");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
