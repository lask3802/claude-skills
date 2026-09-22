# claude-skills

lask 的個人 Claude Code skill 集合，以 **Claude Code plugin marketplace** 形式發佈，方便在所有機器上快速安裝與更新。

## 安裝（每台機器一次）

在 Claude Code 中執行：

```
/plugin marketplace add lask3802/claude-skills
/plugin install lask@claude-skills
```

安裝後 skill 會自動啟用（必要時重啟 Claude Code 或執行 `/reload-plugins`）。

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

## 內含 skills

| 指令 | 說明 |
|------|------|
| `/lask:review-loop` | 每個工作單位：規格落地 → 實作 → **至少兩個、來自不同模型家族的隔離對抗式 reviewer**（Claude `lask:reviewer` + 第二家族：Codex `lask:second-opinion`、Meta Muse、opencode/MiMo 等，配方見 `second-family.md`；同一份 brief、平行派出）→ 逐條裁決（單方發現預設不成立）→ fixer 只修已確認項 → **驗證過的 judge** 決定完成。含 judge 必須先在刻意弄壞的版本上失敗的規則、重複失敗上移成規則、以及 model tier 表（tiering hooks 的拒絕訊息指向這裡）。 |
| `/lask:handoff` | 產生一份自足、可直接複製的「交接文件」（目標、檔案+行號、關鍵發現、決策、現況、下一步），整則訊息就是文件，用 `/copy` 貼到新 session 或交給其他 agent。支援 `/lask:handoff <focus>` 聚焦、`/lask:handoff --file` 另存 HANDOFF.md。 |
| `/lask:codex-run` | 手動派發單一任務給 Codex CLI，用法 `/lask:codex-run [--model sol\|astra\|luna] [--effort low\|medium\|high\|xhigh\|max\|ultra] [--sandbox write\|read] <任務>`（預設 gpt-6-sol；gpt-5.6 仍可用完整名指定）。啟動後立即回傳 workspace-scoped job ID；底層保存純 event JSONL、authenticated owner＋PID、quiet-heartbeat telemetry、獨立 stderr／final-message 與真實 exit code，terminal commit 會綁定 final 的 size＋SHA-256。 |
| `/lask:codex-status` | 查目前 workspace 最新或指定 Codex job；顯示 queued/running/completed 等狀態、reasoning/investigating/editing/verifying 等 phase、最後活動與 artifact 路徑。`--all` 可列出所有 jobs。 |
| `/lask:codex-result` | 讀取最新或指定已結束 job 的 Codex final response；失敗／取消時不會假裝成功。 |
| `/lask:codex-cancel` | 安全取消最新或指定 job。controller 不依 manifest PID 直接殺程序，而由 owning runner 收到 job-specific request 後終止自己的 child tree。 |

## Agent 編制（`Agent` tool 以 `subagent_type` 派遣）

| Agent | model | 職責 |
|---|---|---|
| `lask:scout` | opus | 內部偵察：讀碼、盤結構與現況，回報精煉簡報（唯讀） |
| `lask:researcher` | opus | 外部研究：官方文件、API、生態系（唯讀＋web） |
| `lask:implementer` | opus | 依規格實作＋自測義務（附指令與結果證據）；也擔任 review loop 的 fixer |
| `lask:reviewer` | opus | 對抗式審查：假設變更是錯的，以規格行號為準，severity 分級、每條附失敗情境 |
| `lask:second-opinion` | sonnet | 跨模型審查：唯讀沙箱跑 Codex CLI，以 event＋telemetry JSONL 顯示過程並忠實轉述，採納與否由主 session 逐條裁決 |
| `lask:verifier` | opus | 驗收官／judge：逐條執行驗收，只回報事實、絕不動手修；擔任 judge 時也檢查 judge 本身是否驗證過 |
| `lask:codex-implementer` | sonnet | 透過 Codex CLI（gpt-6-sol，xhigh）建置；跑前後各查一次 5h／週配額，任一視窗剩餘 <20% 即於報告頂端 ⚠️ 警告；sol 若回 400 則停手、不擅自換模型。**只在實測贏過 opus 的任務類型上使用。** |

所有 agent 以統一回報協議收尾（Verdict／Evidence／Changes（僅 implementer）／Self-assessment／Open questions），引用檔案一律可點擊的 `path:line`，長產出寫檔、回報只留摘要。

## Hooks（model tiering）

- **PreToolUse `Agent`/`Task`**（`tier-agent.js`）：spawn 沒帶 `model` 時自動改寫——內建 `Explore` → sonnet、其餘 → opus。明確傳入的 `model`（含 fable）一律尊重；含 `:` 的 plugin agent 交給其定義決定。
- **PreToolUse `Workflow`**（`tier-workflow.js`）：ultracode script 中每個 `agent()` 都必須帶 `model:`（或 pinned `agentType`），否則整個呼叫被擋下並附修正指示；誤判時在 script 加註解 `tier: reviewed` 略過。
- 設計原則 **fail-open**：任何 hook 出錯只會退化成「沒有政策」、`exit 0` 不輸出，絕不弄壞 spawn。2.0 起沒有 SessionStart 注入，也沒有編輯節流。

## 測試（plugin 當 production 對待）

```
node plugins/lask/hooks/scripts/tier.test.js      # model-tiering hook 行為測試
node --test plugins/lask/tests/codex-jsonl-runner.test.mjs plugins/lask/tests/codex-job.test.mjs plugins/lask/tests/content.test.mjs plugins/lask/tests/e2e.test.mjs   # runner／job UX 行為＋內容不變量
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
      hooks.json            # PreToolUse(Agent|Task, Workflow)
      scripts/
        tier-agent.js       # spawn 未帶 model → 改寫為 opus/sonnet
        tier-workflow.js    # 驗證 workflow script 的 agent() 都有分級
        tier.test.js        # model-tiering hook 行為測試
    agents/                 # 七人編制（scout/researcher/implementer/reviewer/second-opinion/verifier/codex-implementer）
    commands/               # codex-status / codex-result / codex-cancel
    scripts/
      codex-job.mjs         # workspace-scoped start/status/result/cancel job UX
      codex-jsonl-runner.mjs # Codex events＋telemetry JSONL／artifact／process-tree runner
    skills/
      review-loop/          # 多家族隔離審查 + judge 的工作單位迴圈（2.0 核心）；second-family.md = 第二家族 reviewer 配方
      codex-run/
      handoff/
    tests/
      codex-job.test.mjs
      codex-jsonl-runner.test.mjs
      content.test.mjs      # 內容不變量
      e2e.test.mjs          # LASK_E2E=1 headless 驗證
archive/
  lask-1.8/                 # 退役的 director／playbooks／fable-sense（含 eval）／debugger
docs/superpowers/           # 1.x 設計文件（歷史）
README.md
```
