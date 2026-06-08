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
    skills/
      handoff/
        SKILL.md
README.md
```
