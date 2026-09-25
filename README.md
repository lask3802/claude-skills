# claude-skills

lask 的個人 Claude Code skill 集合，以 **Claude Code plugin marketplace** 形式發佈，方便在所有機器上快速安裝與更新。

## 安裝（每台機器一次）

在 Claude Code 中執行：

```
/plugin marketplace add lask3802/claude-skills
/plugin install lask@claude-skills
```

安裝後 skill 會自動啟用（必要時重啟 Claude Code 或執行 `/reload-plugins`）。接著執行一次 `/lask:doctor --install`，把 stop rule 裝進 `~/.claude/CLAUDE.md`、建立 design 禁用清單，並在沒有選 output style 時選用 `lask:TW Hybrid`；之後隨時用 `/lask:doctor` 檢查。

> CLI 等效指令（非互動式）：
> ```
> claude plugin marketplace add lask3802/claude-skills
> claude plugin install lask@claude-skills
> ```

## 2.0：從 director 到 review loop

1.x 的核心是 director mode：主 session 只判斷、把實作派給 agent。2.0 把它退役，改以**審查拓撲**為核心。理由有三：

- 2026-07-25 的 Opus 5 2×2 評量已顯示：在有能力的執行者上，分派實作是淨負（評分無增益、成本 1.7–2.5 倍）。Opus 5.5 更強，只會更明顯。
- 實際用量（2026-07-25 → 09-23，62 份 transcript）：`lask:implementer` 派遣 178 次，`lask:reviewer`＋`lask:verifier` 合計 8 次，`lask:second-opinion` 0 次，fable-sense／playbooks 0 次。真正有價值的那一半——獨立驗證——幾乎沒被用到。
- Anthropic 的 code-migration kit（RUN-NOTES）：抓到問題的是**分開 context 的對抗式審查**與**驗證過的 judge**，不是更大的執行模型。

2.0 在 dragonraja-rebon 的實際案例上驗證過（`migration/experiments/2026-09-23-inventory-20/`）：Opus 5.5 產出的 20 列 inventory 草稿通過自身所有驗收與 121 個引用的機械檢查，仍有 25 個缺陷（5 個屬實質錯誤）；三個不同家族的隔離 reviewer 分別找到 15／8／11 個，聯集 24 個，0 個誤報；主 session 自己抽查只找到 3 個。

退役的元件（director／delegation-playbooks／fable-sense skill、director 開關指令與 hooks、debugger agent）完整保存在 `archive/lask-1.8/`，fable-sense 的 eval 證據也在裡面。

## 2.1：對齊 Opus 5.5 playbook

依 [Getting the most out of Opus 5.5](https://claude.dev/blog/getting-the-most-out-of-opus-5-5/)（2026-09-22）的檢查清單，把能程式化的項目做成元件；只靠使用者習慣的項目（附圖而不是重打數字、/fast、/model）不做成元件。（歷史紀錄：2.2 起 `long-run`、`fan-out`、`design-brief` 併入 autonomy 區塊，見下一節。）

| Playbook 項目 | 2.1 元件 |
|---|---|
| 交付整個任務、講清楚「done」長什麼樣 | `lask:long-run`：`Done means` / `Stop and ask only if` / `Out of scope` 寫在 `TASKS.md` 頂端；使用者沒給就自己推導並用一行說出來 |
| CLAUDE.md 寫明何時繼續、何時停下來問 | `/lask:doctor --install` 把受管理的 autonomy 區塊（`templates/claude-md-autonomy.md`）裝進 `~/.claude/CLAUDE.md`：不需要人時繼續、只在缺決策或破壞性操作前停 |
| 破壞性指令仍要跳權限確認 | `destructive-guard.js`：PreToolUse(Bash\|PowerShell) 對 `rm -rf` 出工作目錄、`git push --force`、`reset --hard`、DROP TABLE、publish 等回 `ask`：auto 模式下仍會跳確認（官方文件載明，本機實測 hook 有觸發），headless `-p` 直接拒絕；`LASK_GUARD=0` 關閉 |
| 大型 audit／migration 拆給 subagent 並檢查證據 | `lask:fan-out`：清單落地 → 同一份 brief → 每單位一個 subagent、分波平行 → 接受前親自開證據 → 一張總表 |
| 任務清單放檔案，撐過 context 壓縮 | `lask:long-run` 的 `TASKS.md` ＋ `run-resume.js`：SessionStart(`compact`) 時若找到帶 `Done means:` 且有未完成項的 `TASKS.md`（工作目錄往上找到 repo 根），注入一行指標要求先重讀 |
| 先讀「需要你做什麼」 | autonomy 區塊與 `lask:long-run` 規定結尾三段：`Blocked on me` → `Changed` → `Found` |
| 人看之前先跑一輪 review | autonomy 區塊：宣稱 code change 完成前先跑一次隔離 review（`lask:reviewer` 或 `/code-review`） |
| 研究要標出無法確認的部分 | `lask:researcher` 與 autonomy 區塊：每個無法確認的主張都標出來，並說明查過哪裡 |
| 設計需求列出「不要的」風格 | `lask:design-brief`：累積式禁用清單 `~/.claude/lask/design-avoid.md`（專案可另設 `.claude/design-avoid.md`），交付後列出替代選擇，被否決就加進清單 |
| 刪掉「think hard」、不要求展示推理 | `/lask:doctor` 掃描 CLAUDE.md／AGENTS.md／rules／agents／skills 找這類句子；plugin 自身由 content test 守住 |

## 2.4.2：語音輸入 skill

新增 `/lask:voice-input`，讓每台 Windows 機器都能用同一套方式對 Claude 說話：CapsWriter-Offline 加 Qwen3-ASR-1.7B，跑在 CPU、輸出台灣繁體，按住 CapsLock 說話、放開就打進輸入框。選它是因為同一句中英混說的測試句，SenseVoice 雖然只要 0.13 秒，但句子結構整段垮掉；Qwen3-ASR 要 1.5–1.9 秒，結構正確，剩下「音對字錯」的專有名詞用熱詞修得掉。skill 附多連線下載器 `pdl.py`（GitHub release 單線在台灣只有 0.1–0.4 MB/s），並規定端到端驗證要使用者實際開口、再從 client log 對照原始結果與熱詞修正後的結果。

## 2.4.1：Codex 額度預檢與第二家族替補

問題是 Codex 的額度常在審查跑到一半時用完：已經花掉的額度拿不回來，也沒有結果。現在 `lask:second-opinion` 開跑前先讀 `codex-ratelimit.js` 的快照，任何一個視窗剩不到 10%、而且重置時間還沒到，就回報 `QUOTA-STOP` 和重置時間，不開跑。這個快照只有在 Codex 執行時才會更新，通常已經過期好幾天，所以過期時會先用 low effort 探測一次，探測成功後重讀快照再判斷。腳本會把週額度標成 `primary_5h`，因此回報時一律附上視窗分鐘數。

review-loop 收到 `QUOTA-STOP` 就立刻換人，不等重置。替補是在 2026-09-23 用植入缺陷的基準測過的兩個選擇，都透過 `opencode2 run --agent plan` 執行：

- **`opencode-go/glm-5.3-flash`**：約 2 分鐘，走 Go 訂閱，兩輪都 8/8。
- **`openrouter/openai/gpt-6-sol#high`**：約 3 分鐘、約 $0.27，8/8，而且會抓到 diff 以外的後果（例如 schema trigger 讓 replay 直接丟例外）。

完整結果表在 `second-family.md`；含原始碼的實驗紀錄不放進這個公開 repo。

## 2.4：TW Hybrid output style

回覆改用 `lask:TW Hybrid` 這個 output style：結論和推理用說話的口吻寫成段落，並列的事實用對稱結構排好。依據是 2026-09-23 兩輪盲測（紀錄只在當時的 session 裡，不在這個 repo）。第一輪把 Default、Concise、Simplified Technical Writing、TW Colleague 四篇並排比較，但先讀的那篇會替後面幾篇建好心智模型，「好懂」就沒辦法比。第二輪改成每題只讀一篇、讀完就打分，比的是 Concise、TW Colleague、TW Hybrid：TW Hybrid 在「好懂」拿 5 分、「像人在講話」拿 4 分，另外兩個都是 3／2。每個 style 只有一篇，題目也不同，TW Hybrid 那篇還長一倍，篇幅本身可能影響分數，所以這只能算方向。讀者寫的理由比分數更有用，style 裡的兩條規則就是從這裡來的：

- **機制先講防什麼問題，再講怎麼運作**：TW Colleague 輸在「前因後果太少」，不是口吻不夠口語。
- **專案內部名詞第一次出現就用半句話說明**：Concise 輸在直接用了讀者不熟的名詞（spool）。

style 放在 plugin 裡，是為了跟著 plugin 走到每台機器。但 plugin 只負責提供 style，選用要靠設定，而 `/output-style` 只會寫進專案層的 `.claude/settings.local.json`。所以 `/lask:doctor --install` 會在使用者層的 `settings.json`（`~/.claude/`，或 `CLAUDE_CONFIG_DIR`）寫入 `lask:TW Hybrid`，改檔前先備份。同一層的 `settings.json` 或 `settings.local.json` 已經選了別的 style 就不動；專案層的選擇只影響那個專案，不會擋住寫入。doctor 檢查會依優先順序列出實際生效的是哪一個；settings 不是純 JSON 時不寫入，改成請你手動修。沒有用 `force-for-plugin`，因為它會蓋掉使用者的選擇，連臨時切到 Explanatory 都不行。

它只影響直接對你說話的 main agent：

- **有套用**：互動 session，以及沒帶 `--setting-sources` 的 `claude -p`。
- **不套用**：subagent（官方行為，fork 除外；main agent 轉述時本來就會重寫）、用 `--setting-sources ''` 啟動的 worker 子程序（實測確認）。

## 2.3：依角色固定 effort

依 Artificial Analysis 各 effort 等級的實測（2026-09-23，Opus 5.5）：Intelligence Index low 42 → medium 51 → high 54 → xhigh 56 → max 58；Terminal-Bench 4.0 為 31% → 53% → 57% → 60% → 60%，每題成本 $0.55 → $1.34 → $1.82 → $3.46 → $5.98。high 以上每升一級約翻倍成本、只多 0–3 分；low 在工具操作上掉 22 分（53% → 31%）。

- **agent frontmatter 固定 `effort`**：`scout`、`verifier` → medium；`reviewer` → high；`implementer`、`researcher` 不固定，跟著 session 的 `/effort` 走。Agent 呼叫無法覆蓋 effort，所以只固定角色性質明確的。本機 transcript 顯示中途改 effort 不會讓 prompt cache 失效（6 個 session 在 TTL 內改 effort，下一個 request 的 cache_read 都延續前一輪）。實測 `--effort low` 的主 session 派出的 `lask:reviewer` 跑在 high。
- **`second-opinion` 改用 haiku**：它只是 Codex 的轉述；brief 原文照抄給 Codex，review-loop 的裁決改以 Codex 原始 final-message 檔為準，轉述只當索引。
- review-loop 的 tier 表加上 haiku 與 effort 對照表，並註明 sonnet 不適合多步驟工具工作（Terminal-Bench 4.0：Sonnet 5 high 5%、max 14%）。

## 2.2：只留 CLAUDE.md 做不到的部分

2.1 把 playbook 的每一項都做成元件，但那篇文章的建議多半是「在 prompt 或 CLAUDE.md 講一句」。2.2 用實測決定去留（2026-09-23，`claude -p` 第一次呼叫的實際 token 數，搭配 60 天、524 個 session 的使用紀錄）：

- **併入 CLAUDE.md autonomy 區塊**：`long-run`（`TASKS.md`、`Done means:`、壓縮後重讀）、`fan-out`（每單位一個 subagent、先驗證證據、一張表）、`design-brief`（`design-avoid.md` 當硬性限制、被否決的樣式加進清單）。區塊本身從約 600 tokens 縮到約 330 tokens，同時吸收三個 skill 的規則。`run-resume` hook 照舊認 `TASKS.md` 的 `Done means:` 行。
- **退役到 `archive/lask-2.1/`**：`handoff`（7 次；實際在用的是另一個 1KB 的 `/handoff`，29 次）、`codex-implementer`（60 天 2 次，也沒有贏過 Opus 5.5 的實測）。它內嵌的 Codex 配額讀取程式改成 `scripts/codex-ratelimit.js`，由 `codex-run` 呼叫。
- **model tiering**：subagent 一律 opus，只有機械式工作用 sonnet；**fable 退役**：Agent 呼叫帶 fable 會被改寫成 opus，workflow script 寫 `model: 'fable'` 會被擋下。
- **destructive guard 的本機 git 改看實際狀態**：`reset --hard`、`checkout --`、`restore`、`switch -f`、`clean -f`、`worktree remove --force` 在執行當下查 `git status`（`clean` 則跑同旗標的 `git clean -n`），只有真的會丟掉未 commit 修改或未追蹤檔案時才問；`branch -D`、`stash drop/clear` 靠 reflog/fsck 救得回來，直接放行。force push、刪遠端分支、`reflog expire`、`gc --prune=now`、history rewrite 照舊一律問。同時修掉 `2>&1`、`> /dev/null` 被當成路徑，連單純切分支都跳確認的 bug。
- `/lask:doctor --install` 會先備份，再移除 1.x 留在 `~/.claude/CLAUDE.md` 的 `FABLE-SENSE` 區塊（它指向已不存在的 skill）。
- Codex job 目錄不再跟著環境裡的 `CLAUDE_PLUGIN_DATA` 走（從 Bash 啟動的 job 拿到的是別的 plugin 匯出的值，`start` 與 `/lask:codex-status` 可能各看各的），固定在 temp 下的 `lask-codex-jobs`，可用 `LASK_CODEX_JOB_ROOT` 覆寫。

## 內含 skills

| 指令 | 說明 |
|------|------|
| `/lask:review-loop` | 每個工作單位：規格落地 → 實作 → **至少兩個、來自不同模型家族的隔離對抗式 reviewer**（Claude `lask:reviewer` + 第二家族：Codex `lask:second-opinion`、Meta Muse、opencode/MiMo 等，配方見 `second-family.md`；同一份 brief、平行派出）→ 逐條裁決（單方發現預設不成立）→ fixer 只修已確認項 → **驗證過的 judge** 決定完成。含 judge 必須先在刻意弄壞的版本上失敗的規則、重複失敗上移成規則、以及 model tier 表（tiering hooks 的拒絕訊息指向這裡）。 |
| `/lask:doctor` | 對照 Opus 5.5 playbook 檢查環境：stop rule、think-hard 句、要求展示推理的句子、destructive guard、design 清單、`TASKS.md` 進度、model／effort、過期的 `FABLE-SENSE` 區塊。`--install` 把 autonomy 區塊（stop rule、長任務 `TASKS.md`、每單位一個 subagent、design 禁用清單、回報格式）裝進 `~/.claude/CLAUDE.md`（先備份；本地改過的不覆蓋，除非 `--force`），移除 `FABLE-SENSE` 區塊，並建立 design 清單。 |
| `/lask:codex-run` | 手動派發單一任務給 Codex CLI，用法 `/lask:codex-run [--model sol\|astra\|luna] [--effort low\|medium\|high\|xhigh\|max\|ultra] [--sandbox write\|read] <任務>`（預設 gpt-6-sol；gpt-5.6 仍可用完整名指定）。啟動後立即回傳 workspace-scoped job ID；底層保存純 event JSONL、authenticated owner＋PID、quiet-heartbeat telemetry、獨立 stderr／final-message 與真實 exit code，terminal commit 會綁定 final 的 size＋SHA-256。 |
| `/lask:voice-input` | Windows 語音輸入 Claude：安裝 CapsWriter-Offline＋Qwen3-ASR（CPU、台灣繁體），種熱詞，從 client log 驗證；`tune` 依 log 的原始辨識結果加熱詞修錯字。附多連線下載器 `pdl.py`。 |
| `/lask:codex-status` | 查目前 workspace 最新或指定 Codex job；顯示 queued/running/completed 等狀態、reasoning/investigating/editing/verifying 等 phase、最後活動與 artifact 路徑。`--all` 可列出所有 jobs。 |
| `/lask:codex-result` | 讀取最新或指定已結束 job 的 Codex final response；失敗／取消時不會假裝成功。 |
| `/lask:codex-cancel` | 安全取消最新或指定 job。controller 不依 manifest PID 直接殺程序，而由 owning runner 收到 job-specific request 後終止自己的 child tree。 |

## Agent 編制（`Agent` tool 以 `subagent_type` 派遣）

| Agent | model | 職責 |
|---|---|---|
| `lask:scout` | opus（effort medium） | 內部偵察：讀碼、盤結構與現況，回報精煉簡報（唯讀） |
| `lask:researcher` | opus | 外部研究：官方文件、API、生態系（唯讀＋web） |
| `lask:implementer` | opus | 依規格實作＋自測義務（附指令與結果證據）；也擔任 review loop 的 fixer |
| `lask:reviewer` | opus（effort high） | 對抗式審查：假設變更是錯的，以規格行號為準，severity 分級、每條附失敗情境 |
| `lask:second-opinion` | haiku | 跨模型審查：開跑前先檢查 Codex 額度（不足就回報 `QUOTA-STOP`），唯讀沙箱跑 Codex CLI，brief 原文照抄給 Codex，以 event＋telemetry JSONL 顯示過程並忠實轉述；主 session 以 Codex 的原始 final-message 檔逐條裁決（haiku 只做轉述，判斷在 Codex 與主 session） |
| `lask:verifier` | opus（effort medium） | 驗收官／judge：逐條執行驗收，只回報事實、絕不動手修；擔任 judge 時也檢查 judge 本身是否驗證過 |

所有 agent 以統一回報協議收尾（Verdict／Evidence／Changes（僅 implementer）／Self-assessment／Open questions），引用檔案一律可點擊的 `path:line`，長產出寫檔、回報只留摘要。

## Hooks

### Model tiering

- **PreToolUse `Agent`/`Task`**（`tier-agent.js`）：spawn 沒帶 `model` 時自動改寫——內建 `Explore` → sonnet、其餘 → opus；**明確帶 fable 的改寫成 opus**（fable subagent 已退役）；`model: "inherit"` 視同沒帶（避免把 Fable 主 session 的模型傳下去）；其他明確傳入的 `model` 一律尊重；含 `:` 的 plugin agent 交給其定義決定。
- **PreToolUse `Workflow`**（`tier-workflow.js`）：ultracode script 中每個 `agent()` 都必須帶 `model: 'opus'`／`'sonnet'`（或 pinned `agentType`），寫 `model: 'fable'` 也算違規，整個呼叫被擋下並附修正指示；誤判時在 script 加註解 `tier: reviewed` 略過。
- 設計原則 **fail-open**：任何 hook 出錯只會退化成「沒有政策」、`exit 0` 不輸出，絕不弄壞 spawn。沒有 SessionStart 政策注入，也沒有編輯節流。

### Destructive guard（2.1；git 規則 2.2 改看實際狀態）

- **PreToolUse `Bash`/`PowerShell`**（`destructive-guard.js`）：一律回 `ask`（從不 `deny`），讓人決定。涵蓋：遞迴刪除工作目錄本身／上層／home／磁碟根／`.git`／git repo／只由變數組成的路徑（`"$DIR/$SUB"`，變數為空就是根目錄）／工作目錄外路徑（temp 目錄例外）；非遞迴刪除工作目錄外檔案；`find -delete`、`xargs rm`、`rsync --delete`、PowerShell `Get-ChildItem | Remove-Item` 依上游路徑判斷；送進 DB client 的 DROP／TRUNCATE／無 WHERE 的 DELETE、`dropdb`；格式化磁碟、關機、`npm|pnpm|cargo|poetry publish`、`gem|docker|helm push`、`gh repo|release delete`。
- **git**：遠端歷史（`push --force`／`--force-with-lease`／`--mirror`／刪或 prune remote branch）與會刪掉救援點的操作（`filter-branch`／`filter-repo`、`reflog expire|delete`、`prune`、`gc --prune=<任何值>`、`update-ref -d`）一律問。會動到工作區的 `reset --hard`、`checkout`、`restore`、`switch`、`clean -f`、`worktree remove --force` 在執行當下問 git，只有真的會丟東西才問：
  - 已追蹤檔案有未 commit 的修改（含 staged 新檔、`assume-unchanged` 藏住的修改）；
  - 目標 revision 要寫入的路徑上已經有 index 以外的東西（未追蹤或 ignored 檔、大小寫不同的同名檔、檔案與目錄互換）；單純切分支時 git 會擋未追蹤檔，但會默默蓋掉 ignored 檔，所以只看 ignored；
  - `clean` 跑同旗標（含 `-ff`、`-d`、`-x`）的 `git clean -n`；
  - worktree 依 git 的規則解析（先比結尾路徑、再比完整路徑，Windows 不分大小寫），解析不出來就要求所有 linked worktree 都乾淨。
  
  shell 會改寫的字（變數、glob、`{a,b}`、`~`、`$(…)`、黏著的重導向）不拿來縮小範圍，改檢查整個工作區：整個工作區乾淨就不會丟任何東西。讀不到狀態時一律問：不是 repo、`cd` 到未知路徑、`--git-dir`／`GIT_DIR=`／`env -C`、`-fB`／`-sother` 這類黏在一起的短選項、`--pathspec-from-file`、或所有 git 查詢合計超過 6 秒。`branch -D`、`stash drop|clear` 靠 reflog／fsck 救得回來，放行。重導向（`2>&1`、`> log`）不算參數。經過兩輪隔離審查，找到的 16 種漏問寫法都有重現測試，並用變異測試確認測試會抓到。
- 追蹤 `cd`／`pushd`／`Set-Location`，看穿 `if`／`for`／`while`／`( )`／`{ }`、`sudo -u`／`nice -n`／`timeout` 等包裝，以及 `bash -c`、`pwsh -Command`／`-EncodedCommand`、`cmd /c`、`eval` 巢狀指令；已知值的變數（`$HOME`、`$PWD`、`$env:X`、`%X%`）會展開。heredoc／here-string 內容是資料，只有被 shell 或 DB client 讀取時才檢查；commit message 或 grep 字串裡的 SQL 不會觸發。
- 權限模式：官方文件載明 hook 的 `ask` 在 auto 模式仍會跳確認；headless `-p` 會直接拒絕（本機以 `claude -p --plugin-dir` 實測 `git stash clear` 被列入 `permission_denials`）；`bypassPermissions` 下的行為文件未寫明（issue #37420 回報會跳確認，且之後該 session 不再是 bypass）。
- 定位：抓 agent 實際會寫出的破壞性寫法的絆線，不是防有人刻意藏指令的安全邊界；靜態解析永遠有漏網寫法，發現就補測試再補規則。
- `LASK_GUARD=0` 關閉。fail-open：解析失敗就不表態。

### Run resume（2.1）

- **SessionStart `compact`**（`run-resume.js`）：只有在 context 壓縮後、且從工作目錄往上到 repo 根（或 `CLAUDE_PROJECT_DIR`）找到帶 `Done means:` 行（autonomy 區塊規定的長任務格式）、code fence 外還有未完成項的 `TASKS.md` 時，注入一行指標（檔案路徑與 open／done 數量）要求先重讀。其他時候完全靜默，不注入任何政策。

## 測試（plugin 當 production 對待）

```
node plugins/lask/hooks/scripts/tier.test.js      # model-tiering hook 行為測試
node --test plugins/lask/tests/codex-jsonl-runner.test.mjs plugins/lask/tests/codex-job.test.mjs plugins/lask/tests/hooks.test.mjs plugins/lask/tests/doctor.test.mjs plugins/lask/tests/content.test.mjs plugins/lask/tests/e2e.test.mjs   # runner／job UX、guard／resume hook、doctor 行為＋內容不變量
LASK_E2E=1 node --test plugins/lask/tests/e2e.test.mjs                            # headless E2E（燒 token；--plugin-dir 載入 repo 工作副本）
LASK_E2E=1 LASK_E2E_DISPATCH=1 node --test plugins/lask/tests/e2e.test.mjs        # 另含 lask:scout 實地派遣 sentinel 驗證（雙重 gate）
LASK_E2E=1 LASK_E2E_INSTALLED=1 node --test plugins/lask/tests/e2e.test.mjs      # 安裝後 smoke（驗 user-scope 安裝）
```

> 測試指令一律具名列出檔案（本機 node 拒絕 `--test` 只給目錄）。

> 需求：`node` 在 PATH 上；E2E 另需 `claude` CLI；`lask:second-opinion` 需已認證的 `codex` CLI。

> Codex job 的 cancel 是 cooperative ownership：controller 只寫 job-specific request，owning runner 再終止其 child tree；manifest PID 永遠不被 controller 直接 signal。正常 cancel 與 parent/waiter timeout 已覆蓋，Windows `taskkill /T /F` 失敗時 job 會標 failed、不會假裝 cancelled。若 runner 本身遭 OS 級強制終止（例如 SIGKILL／Task Manager End Process），純 Node 版本沒有 Windows Job Object／POSIX parent-death native supervisor，Codex child 仍可能成為 orphan；此時不要只看 PID 手動重試，先依 workspace process／artifact 證據處理。

## 更新

推送新版到本 repo 後，每台機器執行：

```
/plugin update lask@claude-skills
```

（或在 `/plugin` 管理介面更新。）

## 新增 skill

1. 在 `plugins/lask/skills/<new-skill>/SKILL.md` 新增。
2. `git commit` 並 `git push`。
3. 各機器 `/plugin update lask@claude-skills`，即可使用 `/lask:<new-skill>`。

## 結構

```
.claude-plugin/
  marketplace.json          # marketplace 定義（name: claude-skills）
plugins/
  lask/                     # plugin（name: lask → 命名空間 /lask:）
    .claude-plugin/
      plugin.json
    hooks/
      hooks.json            # PreToolUse(Agent|Task, Workflow, Bash|PowerShell) + SessionStart(compact)
      scripts/
        tier-agent.js       # spawn 未帶 model → opus/sonnet；fable → opus
        tier-workflow.js    # 驗證 workflow script 的 agent() 都有分級、沒有 fable
        destructive-guard.js # 破壞性 shell 指令 ask；本機 git 看 git status
        run-resume.js       # 壓縮後指回 TASKS.md
        tier.test.js        # model-tiering hook 行為測試
    output-styles/
      tw-hybrid.md          # lask:TW Hybrid：說話的口吻講因果，並列事實用對稱結構
    agents/                 # 六人編制（scout/researcher/implementer/reviewer/second-opinion/verifier）
    commands/               # doctor / codex-status / codex-result / codex-cancel
    templates/
      claude-md-autonomy.md # doctor --install 裝進 ~/.claude/CLAUDE.md：stop rule、長任務、fan-out、design 清單、回報格式
      design-avoid.md       # design 禁用清單種子
    scripts/
      doctor.mjs            # Opus 5.5 playbook 檢查＋--install
      codex-job.mjs         # workspace-scoped start/status/result/cancel job UX
      codex-jsonl-runner.mjs # Codex events＋telemetry JSONL／artifact／process-tree runner
      codex-ratelimit.js    # Codex 5h／週配額快照（codex-run 用）
    skills/
      review-loop/          # 多家族隔離審查 + judge 的工作單位迴圈（2.0 核心）；second-family.md = 第二家族 reviewer 配方
      codex-run/
      voice-input/          # Windows 語音輸入（CapsWriter＋Qwen3-ASR CPU）；pdl.py = 多連線下載器
    tests/
      codex-job.test.mjs
      codex-jsonl-runner.test.mjs
      hooks.test.mjs        # destructive-guard／run-resume 行為
      doctor.test.mjs       # doctor 檢查與 --install
      content.test.mjs      # 內容不變量
      e2e.test.mjs          # LASK_E2E=1 headless 驗證
archive/
  lask-1.8/                 # 退役的 director／playbooks／fable-sense（含 eval）／debugger
  lask-2.1/                 # 2.2 退役的 long-run／fan-out／design-brief（併入 autonomy 區塊）、handoff、codex-implementer
docs/superpowers/           # 1.x 設計文件（歷史）
README.md
```
