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

## 內含 skills

| 指令 | 說明 |
|------|------|
| `/lask:handoff` | 產生一份自足、可直接複製的「交接文件」（目標、檔案+行號、關鍵發現、決策、現況、下一步），整則訊息就是文件，用 `/copy` 貼到新 session 或交給其他 agent。支援 `/lask:handoff <focus>` 聚焦、`/lask:handoff --file` 另存 HANDOFF.md。 |
| `/lask:director` | Director-mode 完整 rubric：操作迴圈、派遣 prompt 四件套、執行者模型與驗證強度的情境校準表、跨模型 second-opinion 裁決守則。 |
| `/lask:delegation-playbooks` | 五大場景（feature／bugfix／research／refactor／review）的標準派遣迴圈、現成 dispatch prompt 與升級點。 |
| `/lask:codex-run` | 手動派發單一任務給 Codex CLI：實測驗證的 model×effort 呼叫表（`gpt-5.6-sol/terra/luna` × `none/low/medium/high/xhigh`；`minimal` 三模型皆 400）、stdin 提示、背景執行規則、last-message 回收、四段固定回報格式（Codex 回報／實際變更／執行參數／異常）與故障對照表（capacity=暫時性重試一次、model not supported=停手不換模、MCP 噪音=忽略）。全程機械化——sonnet／haiku 執行者可照表操課，結果忠實轉述給 user／director。 |
| `/lask:fable-sense` | 高難度／模糊／高風險任務的「條件工程」紀律：任務書（brief）模板、新鮮派發、調查式措辭（絕不把猜測嵌進派發）、執行證據、跨模型尾部防護（codex exec ↔ claude -p，≥10 分鐘 timeout）。實證基礎：19 次預先登錄評測全數達標（Opus 4.8＋Codex gpt-5.5），證明拉開差距的是條件而非模型智力；附凍結的 `eval/` 供模型更新後重驗。Codex 端雙軌手動安裝：`SKILL.md` 複製到 `~/.codex/skills/fable-sense/`（同 agentskills.io 規格，供點名調用），`codex-agents-block.md` 裝進 `~/.codex/AGENTS.md`（常駐觸發——實測描述式自動觸發不可靠，區塊不可省）。機械性任務自動跳過。 |

## Director mode（安裝即生效）

主 session（通常是 fable）只負責判斷：理解、決策、派遣、驗收、溝通；實作與蒐集交給內建 agent 編制。SessionStart 注入一段 `<lask-director-policy>`（唯一常駐 token 開銷，約 600 tokens），內含直接動手門檻（單檔 ≤10 行）、編制名單與「執行者模型 × 驗證強度」情境校準表 —— 重要工作買的是更多驗證，不是更大的執行模型。

### Agent 編制（`Agent` tool 以 `subagent_type` 派遣）

| Agent | model | 職責 |
|---|---|---|
| `lask:scout` | opus | 內部偵察：讀碼、盤結構與現況，回報精煉簡報（唯讀） |
| `lask:researcher` | opus | 外部研究：官方文件、API、生態系（唯讀＋web） |
| `lask:implementer` | opus | 依規格實作＋自測義務（附指令與結果證據） |
| `lask:debugger` | opus | 系統性根因調查；證據鏈 path:line 錨定；未授權不修 |
| `lask:verifier` | opus | 驗收官：逐條驗 acceptance criteria，只回報事實、絕不動手修 |
| `lask:reviewer` | opus | 初審：正確性→風險→可維護性，severity 分級 findings |
| `lask:second-opinion` | sonnet | 跨模型第三方審查：唯讀沙箱跑 Codex CLI 並忠實轉述，採納與否由 director 逐條裁決 |
| `lask:codex-implementer` | sonnet | 透過 Codex CLI（gpt-5.6-sol，xhigh）建置比 opus 高一階的實作（更深的多步推理，但還不到 fable）；薄監督層，重推理在 Codex 端。跑前後各查一次 5h／週配額，任一視窗剩餘 <20% 即於報告頂端 ⚠️ 警告；sol 若回 400「model not supported」則誠實回報並停手，不擅自換模型 |

所有 agent 以統一回報協議收尾（Verdict／Evidence／Changes（僅 implementer/debugger）／Self-assessment／Open questions），引用檔案一律可點擊的 `path:line`，長產出寫檔、回報只留摘要。

### Hooks（沿用並保留 + v2 enforcement）

- **PreToolUse `Agent`/`Task`**（`tier-agent.js`）：spawn 沒帶 `model` 時自動改寫——內建 `Explore` → sonnet、其餘 → opus。明確傳入的 `model`（含 fable）一律尊重；含 `:` 的 plugin agent 交給其定義決定。
- **PreToolUse `Workflow`**（`tier-workflow.js`）：ultracode script 中每個 `agent()` 都必須帶 `model:`（或 pinned `agentType`），否則整個呼叫被擋下並附修正指示；誤判時在 script 加註解 `tier: reviewed` 略過。
- **PreToolUse `Edit`/`Write`/`NotebookEdit`**（`director-enforce.js`，1.3.0 新增）：只針對**主 session**的直接檔案編輯。決策階梯（每 session 計數）：
  - 瑣碎編輯（≤10 行、且本 session 累計 ≤1 個檔案）→ 靜默放行、不計 strike。
  - 其餘 → strike++；strike 1–2 以 `additionalContext` **提醒但放行**（事實陳述句，附本 session 的計數與 `lask:implementer` 指引），strike ≥3 **拒絕**（並說明派遣或開啟 hands-on 後即可重試）。
  - **hands-on 逃生門**：使用者授權動手時，建立訊息中所示的旗標檔 `<CLAUDE_PLUGIN_DATA>/enforce/<session_id>.handson`，該 session 即完全豁免。subagent 的編輯（stdin 帶 `agent_id`）永遠不計——那正是預期的分工路徑。
- 設計原則 **fail-open**：任何 hook 出錯（stdin 壞掉、缺欄位、state 目錄不可寫……）只會退化成「沒有政策」、`exit 0` 不輸出，絕不弄壞編輯或 spawn。主 session 模型完全不受影響。設計文件：`docs/superpowers/specs/2026-07-02-director-mode-v2-enforcement.md`。

### 測試（plugin 當 production 對待）

```
node plugins/lask/hooks/scripts/tier.test.js      # model-tiering hook 行為測試
node plugins/lask/hooks/scripts/enforce.test.js   # director-enforce hook 行為測試（12 案）
node --test plugins/lask/tests/content.test.mjs plugins/lask/tests/e2e.test.mjs   # 內容不變量（roster／skills／hooks／README）
LASK_E2E=1 node --test plugins/lask/tests/e2e.test.mjs                            # headless E2E（燒 token；--plugin-dir 載入 repo 工作副本）
LASK_E2E=1 LASK_E2E_DISPATCH=1 node --test plugins/lask/tests/e2e.test.mjs        # 另含 lask:scout 實地派遣 sentinel 驗證（雙重 gate）
LASK_E2E=1 LASK_E2E_INSTALLED=1 node --test plugins/lask/tests/e2e.test.mjs      # 安裝後 smoke（驗 user-scope 安裝）
```

> 測試指令一律具名列出檔案（本機 node 拒絕 `--test` 只給目錄）。

> 需求：`node` 在 PATH 上；E2E 另需 `claude` CLI；`lask:second-opinion` 需已認證的 `codex` CLI。
> 設計文件：`docs/superpowers/specs/2026-07-02-director-mode-design.md`（前身：`2026-06-11-model-tiering-design.md`）。

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
      hooks.json            # SessionStart + PreToolUse(Agent|Task, Workflow, Edit|Write|NotebookEdit)
      scripts/
        director-context.js # 注入 director-mode 政策
        tier-agent.js       # spawn 未帶 model → 改寫為 opus/sonnet
        tier-workflow.js    # 驗證 workflow script 的 agent() 都有分級
        director-enforce.js # 主 session 直接編輯 → 提醒→拒絕（hands-on 逃生門）
        tier.test.js        # model-tiering hook 行為測試
        enforce.test.js     # director-enforce hook 行為測試
    agents/                 # 八人編制（scout/researcher/implementer/debugger/verifier/reviewer/second-opinion/codex-implementer）
    skills/
      director/             # 核心 rubric
      delegation-playbooks/ # 五場景打法
      fable-sense/          # 硬任務條件工程（含 codex adapter 與凍結 eval）
      handoff/
    tests/
      content.test.mjs      # 內容不變量
      e2e.test.mjs          # LASK_E2E=1 headless 驗證
README.md
```
