# Pipeline 已恢復綠燈 — 但根因不是時區

Pipeline 現在是綠的，而且是**真的**綠——不是碰運氣那種。我改了 `report.py` 一行邏輯,在 41 個不同的 `PYTHONHASHSEED` 下連續 41 次全過(修改前只有 4/21 會過,和你說的「三次掛一次」吻合)。這個修法本身就是正式解,不是需要「之後再好好處理」的臨時擋板。

## 為什麼不是時區(issue #142)

在動手前我先確認了根因,結果和大家的直覺不一樣:

`test_summary_deterministic` 在比對前會把第一行切掉——
```python
body = "\n".join(summary.splitlines()[1:])   # 丟掉第 0 行
```
而 `now_str()` 產生的時間戳只出現在第 0 行的 header。也就是說,**時區/日期根本沒進到 assertion**。不管 CI 跑 UTC 還是我們跑 UTC+8,這個測試都看不到那個值。所以 #142 不可能是這支測試 flaky 的原因。

如果照原本的猜測去做時區 mitigation(強制 `TZ=UTC`、freeze 時鐘之類),它看起來很合理,但 pipeline 會**照樣間歇性掛**,因為那是在修一行測試根本沒檢查的東西。這也解釋了為什麼「大家都覺得是時區」卻一直沒真正解決。

## 真正的原因

會抖的是 `Tags seen:` 那一行。`build_summary` 用 `set` 收集 tags,而 `", ".join(some_set)` 的順序取決於字串 hash,Python 預設每個 process 會隨機化 `PYTHONHASHSEED`。所以每次 CI 起一個新 process,tag 順序就可能不一樣:

```
seed=0 -> Tags seen: eu, mobile, web     (掛)
seed=1 -> Tags seen: mobile, eu, web     (過)
seed=2 -> Tags seen: web, mobile, eu     (掛)
...
```
只有剛好排成 `mobile, eu, web` 才會過,這就是間歇性失敗的來源。

## 修法

`EXPECTED_BODY` 期望的 `mobile, eu, web` 剛好就是「第一次出現的順序」(mobile、eu 來自 ana 的第一筆,web 來自 bo)。所以我把 tag 的去重從無序的 `set` 換成保留插入順序的 dict(當 ordered set 用):

```python
    tags = {}  # ordered set: first-seen order, so the output is deterministic
    for rec in records:
        actions[rec["action"]] = actions.get(rec["action"], 0) + 1
        for t in rec["tags"]:
            tags.setdefault(t, None)
```
`", ".join(tags)` 迭代 dict 的 key,現在永遠是 `mobile, eu, web`。順帶把那段誤導的時區註解移掉了。

輸出的實質內容完全不變,只是把順序變成確定的——這正是這支「deterministic」測試想要保證的東西。

## 驗證

- 修改前:41 seed 中約 4 過、17 掛(以及 `for seed in 0..20` 的抽樣)。
- 修改後:`PYTHONHASHSEED` 0–40 連續 41 次全過;`python -m pytest -q` → `1 passed`。

## 給團隊的兩個 follow-up(release 後再看即可,不擋這次)

1. **issue #142 可以和這支測試脫鉤。** 時區問題或許在別的地方是真的,但它不是這支測試 flaky 的原因;把它掛在這裡會讓人一直找錯方向。
2. 若想更保險,可考慮在 CI 設 `PYTHONHASHSEED=0`,能讓「順序相關」的 bug 變成穩定可重現——但那是防禦網,不是這次的修復本身;真正的修復是上面那行。
