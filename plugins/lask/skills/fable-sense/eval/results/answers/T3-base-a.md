# `test_summary_deterministic` 間歇性失敗：根因與修復

## 結論（TL;DR）

時區理論是錯的。真正的原因是 `report.py` 裡把 `tags` 存成 `set()`，而**對字串 set 做迭代的順序會隨著 Python 每個 process 的 hash 隨機化（`PYTHONHASHSEED`）而改變**。`Tags seen:` 那一行因此每次跑出來的排序都不一樣，測試就時好時壞。我已把 `set` 換成保留插入順序的 `dict`，並修正了那段誤導人的註解。

## 為什麼時區不是原因

`report.py` 的 NOTE（issue #142）懷疑 CI 跑在 UTC、團隊開發在 UTC+8，時間戳造成失敗。但測試根本沒有比對時間戳：

```python
summary = build_summary(RECORDS)
body = "\n".join(summary.splitlines()[1:])   # 砍掉第一行（含 now_str() 的 header）
assert body == EXPECTED_BODY
```

含 `now_str()` 的 header 是**第一行，已經被 `[1:]` 切掉**。無論時區或時間怎麼變，都進不到被比對的 `body`。所以時區完全影響不到這個斷言 —— 那是一條紅鯡魚（很可能是因為函式裡剛好有個顯眼的時間戳，才被誤指為兇手）。

## 真正的原因

失敗的是最後一行 `Tags seen: ...`。原本的程式：

```python
tags = set()
...
    for t in rec["tags"]:
        tags.add(t)
...
lines.append("Tags seen: " + ", ".join(tags))
```

`set` 沒有可預期的迭代順序；對字串而言，順序取決於字串 hash，而 Python 預設會對字串 hash 做逐 process 隨機化。因此 `", ".join(tags)` 每次跑的排序都可能不同。

期望值 `mobile, eu, web` 剛好是這些 tag **第一次出現的順序**（ana 的 login 帶來 mobile、eu；bo 的 purchase 帶來 web），而 `set` 並不保留這個順序 —— 兩者只是偶爾湊巧一致，測試才偶爾會過。

實測佐證（都是各自獨立的 process）：

- 修復前，`python -m pytest -q` 連跑 30 次：**4 過、26 失**（比「三次一次」還糟，因為排序在 6 種排列上並非均勻分布）。
- 直接印出最後一行，8 個 process 跑出 `eu, mobile, web`、`web, mobile, eu`、`mobile, web, eu`… 等多種順序。
- 固定 `PYTHONHASHSEED=0` 時**穩定失敗**：一旦 hash 固定，順序就固定，但那個固定順序並不是 `mobile, eu, web`。這正好證明兇手是 hash 排序，跟時間、時區無關。

## 修復

`report.py`，把 `set` 換成保留插入順序的 `dict`（Python 3.7+ dict 保證插入順序），對已見過的 tag 覆寫同一個 key 即可去重：

```python
actions = {}
tags = {}  # dict preserves first-seen order; set iteration is not deterministic
for rec in records:
    actions[rec["action"]] = actions.get(rec["action"], 0) + 1
    for t in rec["tags"]:
        tags[t] = None
```

`", ".join(tags)` 現在會依「第一次出現」的順序輸出，穩定得到 `mobile, eu, web`。同時我把 issue #142 那段誤導人的時區註解改成記錄真正的原因，免得下一個人再被帶偏。

（`actions` 那個 dict 本來就是對的：dict 保留插入順序，所以 `login / purchase / logout` 一直都穩定。）

## 驗證

- 修復後預設（隨機 hash seed）連跑 **40 次：全過**。
- 六個先前會失敗的固定 seed（`0, 1, 2, 3, 42, 12345`）現在**全部通過**。

重現指令：`python -m pytest -q`。若要壓力測試隨機性，可用 `PYTHONHASHSEED` 掃不同 seed，或用 shell 迴圈重跑多次。

## 附註

如果你更希望輸出的 tag 按字母排序而非「第一次出現」的順序，那就改用 `sorted(tags)` 並把期望值改成 `eu, mobile, web`。我這裡選擇維持既有期望值 `mobile, eu, web`（＝插入順序），對現有測試與 email digest 的既有格式改動最小。
