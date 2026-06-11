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
| `/lask:model-tiers` | spawn agent 時的模型分級 rubric（sonnet＝機械式、opus＝預設主力、fable＝僅限明確指派的高複雜判斷任務）。Claude 會在需要時自動參考；亦可手動呼叫查規則。 |

## Model tiering（hooks，安裝即生效）

主 session 跑 fable 時，所有 spawn 路徑（Agent tool / agent team / ultracode Workflow `agent()`）預設會繼承 fable，token 燒很快。本 plugin 用 hooks 強制分級：

- **SessionStart**：注入一段精簡政策（唯一的常駐 token 開銷，約 200 tokens）。
- **PreToolUse `Agent`/`Task`**：spawn 沒帶 `model` 時自動改寫——`Explore` → sonnet、其餘 → opus。明確傳入的 `model`（包含 fable）一律尊重；plugin 命名空間的 agent type（含 `:`）交給其定義決定。
- **PreToolUse `Workflow`**：ultracode workflow script 中每個 `agent()` 都必須帶 `model:`（或 pinned `agentType`），否則整個呼叫被擋下並附上修正指示。誤判時在 script 開頭加註解 `tier: reviewed` 可略過檢查。

設計原則：**fail-open**——hook 出錯（如機器上沒有 node）只會退化成「沒有分級」，不會弄壞 spawn。主 session 的模型完全不受影響。

> 需求：`node` 在 PATH 上（npm 安裝的 Claude Code 機器都有）。
> 暫時停用：`/plugin` 介面 disable lask plugin，或移除 `plugins/lask/hooks/hooks.json`。
> 測試：`node plugins/lask/hooks/scripts/tier.test.js`。
> 設計文件：`docs/superpowers/specs/2026-06-11-model-tiering-design.md`。

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
      hooks.json            # SessionStart + PreToolUse(Agent|Task, Workflow)
      scripts/
        tier-context.js     # 注入分級政策
        tier-agent.js       # spawn 未帶 model → 改寫為 opus/sonnet
        tier-workflow.js    # 驗證 workflow script 的 agent() 都有分級
        tier.test.js        # node tier.test.js
    skills/
      handoff/
        SKILL.md
      model-tiers/
        SKILL.md
README.md
```
