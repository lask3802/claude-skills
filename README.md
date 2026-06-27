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
| `/lask:roast` | 召集一個嚴格但公正的「孵化器面板」拷打你的專案/功能/商業決策/議題：五個對抗式專家視角（擴張者、第一性、資料蒐集、批判、用戶）**互相交叉質詢**，最後收斂成單一決斷 **KILL / PIVOT / PERSEVERE / SCALE** + 唯一該改的瓶頸，而非一篇你好我好的 review。`/lask:roast` 拷打專案現況；`/lask:roast <議題>` 聚焦特定問題。建議搭配 `ultracode` / agent team 同時生成五角加速。 |

## 內含 agents（可單獨呼叫，亦為 roast 面板成員）

| Agent | 角色 |
|-------|------|
| `lask:expander` | 擴張者／成長策略：JTBD・North Star・成長迴圈・land-and-expand 變現階梯・RICE，產出 Now/Next/Later 擴張路線＋強制 Won't-build 清單（非功能許願單）。 |
| `lask:first-principles` | 第一性思考者（Musk/Aristotle/Munger）：拆 invariants vs assumptions、Musk 五步演算法、idiot index，產出排序的 BUILD/CUT 清單（是決策，不是拆解秀）。 |
| `lask:researcher` | 資料蒐集者：≥3 獨立主要來源三角驗證、雙法市場估算、競品表、Steam/Boxleiter 估值帶；可驅動 codex CLI 與 headless Chrome 繞 API；絕不端出無來源數字。 |
| `lask:critic` | 批判者（逆向／紅隊）：先 steelman→base rate→invert→pre-mortem，找唯一最可能致死點＋可證偽 kill-criterion（指標+門檻+日期）＋本週最便宜的反證實驗；可拉 codex 一起壓測技術假設。 |
| `lask:user-advocate` | 用戶（懷疑型買家）：扮一個具名、有預算、已有替代品的目標用戶，逐分鐘走第一局，Van Westendorp 報價，收 **BUY/WISHLIST/SKIP/REFUND** 裁決。 |

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
  lask/                     # plugin（name: lask → 命名空間 /lask: 與 lask:<agent>）
    .claude-plugin/
      plugin.json
    agents/                 # 可重複使用的子代理人（roast 面板成員）
      expander.md
      first-principles.md
      researcher.md
      critic.md
      user-advocate.md
    skills/
      handoff/
        SKILL.md
      roast/
        SKILL.md
scripts/
  validate-plugin.mjs       # 把 agent/skill 當程式碼跑的結構驗證（CI/commit gate）
README.md
```

## 驗證

agent 與 skill 即「prompt 程式碼」，提交前先跑結構驗證：

```
node scripts/validate-plugin.mjs
```

檢查所有 manifest 可解析、frontmatter 必填欄位齊全、名稱合法、roast 確實引用到存在的 agent。
