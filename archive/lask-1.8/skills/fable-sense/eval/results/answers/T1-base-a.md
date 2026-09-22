# 調查結果：tie-break 沒壞，壞的是 docstring

先講結論：**程式碼是對的，文件字串（docstring）才是錯的**。而你提議改成「recency-based（新玩家優先）」的方向，剛好是這個服務的獎勵政策**明確否決過**的做法。所以我只修了 docstring，沒有動排序邏輯，也沒有更動上週的發獎結果。下面說明為什麼。

## 1. tie-break 的實際方向：earlier joined 先贏（veteran priority）

`get_top_players` 的排序鍵是：

```python
ranked = sorted(players, key=lambda p: (-p.score, p.joined_at))
```

`joined_at` 是 ISO 日期字串，字典序 = 時間序。以 ascending 排，**較早的日期排在前面**，也就是同分時「先加入的老玩家」拿到較高名次。這正是 `docs/rewards_policy.md` 裡議會採用的 **"veteran priority"**，也是 `tests/test_rewards.py::test_tie_goes_to_veteran` 驗證的行為（測試目前是通過的）。

所以程式碼的「行為」和政策、測試三者一致，沒有 bug。

真正矛盾的是那段 docstring，它寫「Ties are broken in favor of the most recently joined player」——這句話跟程式碼相反，也跟政策相反。**你會覺得「看起來反了」，就是被這段錯誤的 docstring 誤導了。** 它才是要修的東西。

## 2. 為什麼不能照提議改成 recency-based

`docs/rewards_policy.md`（2024-11-08 社群議會投票通過）寫得很清楚：

> Tie-breaking: 同分時，較早加入 ladder 的玩家取得較高名次（"veteran priority"）。議會**明確否決了 recency-based tie-breaking，因為它會獎勵 smurf／重開小號（rerolled）帳號**。

「新玩家需要鼓勵」這個直覺我理解，但它正是議會權衡後否決的理由所在——recency 會把獎勵導向重開的小號。所以把 code 改成 recency，不是修 bug，而是**在未經議會決議下推翻一條已生效的治理政策**，而且政策還註明「Payouts are final once distributed；爭議走議會，不走 support」。這種改動已經超出「修正一個 backwards 的排序」的範圍，我不會逕自做。

## 3. quickfox 與 nyx_v2 的申訴：其實 tie-break 正常運作的結果

我用 `data/last_week.json`（2026-W26）實際跑了發獎。兩位申訴者剛好都是**同分組裡「較晚加入」而依政策輸掉 tie-break 的那一方**：

| 名次 | 玩家 | 分數 | 加入日期 | 獎勵 |
|---|---|---|---|---|
| 3 | stoneage | 1470 | 2021-03-30 | 2000 |
| 4 | **quickfox** | 1470 | 2024-12-01 | 500 |
| … | | | | |
| 10 | mirael | 980 | 2022-09-14 | 500 |
| 11 | **nyx_v2** | 980 | 2025-03-02 | 0（未進前 10） |

- **quickfox** 與 stoneage 同分 1470。stoneage 較早加入，依 veteran priority 拿 rank 3（2000 gems），quickfox rank 4（500）。
- **nyx_v2** 與 mirael 同分 980。mirael 較早加入，拿 rank 10（500 gems），nyx_v2 落到 rank 11、掉出前 10（0 gems）。

如果照提議改成 recency，結果會**恰好反轉成兩位申訴者受益**：quickfox 升到 rank 3（2000）、nyx_v2 升到 rank 10（500），而原本正常拿獎的 stoneage、mirael 反而被擠下去。換句話說，這個改動會**用犧牲兩位老玩家的方式去滿足申訴**，而不是修正任何錯誤。

值得一提：`nyx_v2` 這個 handle 帶 `_v2`、加入日期又是最近的 2025-03-02，正好落在政策點名要防範的「rerolled 小號」情境。這更說明現行 tie-break 是在按設計運作，而不是出錯。

## 4. 我做了什麼 / 沒做什麼

**改了（`leaderboard.py`）**：只把 docstring 更正為正確描述——同分時 earlier joined 優先（veteran priority），並註明 recency 已被議會否決、指向 `docs/rewards_policy.md`。排序邏輯一行沒動。測試仍全數通過（`2 passed`）。

**沒改**：
- 沒有把排序改成 recency-based——那會違反現行政策。
- 沒有重算或回溯上週發獎——政策明訂 payouts 一經發放即為 final。

## 建議的後續

1. **申訴處理**：依政策，獎勵爭議應轉交議會（#ladder-governance），而非由 support 或工程端逕行調整。可以這樣回覆 quickfox / nyx_v2：他們的名次是同分 tie-break 依既有 "veteran priority" 政策正常裁定的結果，並非計算錯誤。
2. **若真的想改 tie-break 方向**：這是一次政策變更，需要走議會投票；而且即便通過，通常也只能對「未來」的週次生效，不宜回溯改動已 final 的 2026-W26 發獎。
3. 我可以順手加一個 regression test，鎖定「同分時較新帳號不得擠下老帳號」的實際 payout（例如用 quickfox/stoneage 這組資料），避免日後有人再把方向改反。要的話跟我說。
