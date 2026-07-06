# Telemetry dedupe：實作完成

`pipeline/dedupe.py` 的 `dedupe(events)` 已實作完成，並附上測試 `pipeline/test_dedupe.py`（10 項全數通過）。它是一個 **streaming generator**，逐一消化事件並往下游 yield，記憶體有上界，可在 edge worker 上長跑數週。用實際擷取的流量 `data/events_sample.jsonl` 驗證：14 筆進、11 筆出，正確丟掉 3 筆重送，且**沒有遺失任何真實事件**。

## 這份流量藏了兩個陷阱，決定了整個設計

我先分析了 `events_sample.jsonl`，重複來自兩種機制（與 README／`config/gateway.yaml` 描述一致）：

- **Client retry**：SDK 在等不到 ACK 時重送，`event_id` 相同、`attempt` 遞增、`sent_at` 更新，其餘不變（`ev-7f02`、`ev-7f04`、`ev-7f01`）。
- **Gateway redelivery**：reconnect 時整批重送，是逐位元相同的副本。

**陷阱一（正確性）**：`event_id` 並非唯一。`ev-7f08` 出現兩次、`attempt` 都是 1，但 payload 一個是 `screen: home`、一個是 `screen: shop`——這是兩筆真實而不同的事件，只是撞了同一個 id。**若用 `event_id` 當去重鍵，就會靜默丟掉一筆真實資料。** 因此我用「事件內容」當身分：對整個事件做穩定雜湊，但**排除 retry 才會變的欄位 `attempt` 與 `sent_at`**。這樣 retry 與 redelivery 都會收斂成一筆，而撞 id 的不同事件會各自保留。

**陷阱二（記憶體）**：worker 常駐數週、128 MB 上限、~2k events/sec。一個永遠成長的 `seen_ids = set()` 會在數天內把 worker OOM 掉。關鍵觀察：重複只會在 gateway 的 **redelivery window（`config/gateway.yaml` 為 10 分鐘）** 內抵達，所以**只需要記住近期事件**。我用一個以事件時間（`sent_at`）滑動的視窗，過期的 key 會被淘汰，記憶體因此被壓在「約一個視窗的流量」而非整段執行期。

## 實作重點

- **Streaming generator**：簽名 `dedupe(events, window_seconds=..., ...)`，與 `enrich.py` 同一個 idiom，可鏈接 `gateway → dedupe → enrich → sink`；已實測 `enrich(dedupe(events), region)` 全程 lazy、不會把整條 stream 讀進記憶體。
- **內容指紋**：對事件（去掉 `attempt`／`sent_at`）做 `json.dumps(sort_keys=True)` 後取 `blake2b` 128-bit digest。`sort_keys` 讓指紋與欄位順序無關，`default=str` 讓非 JSON 值不會弄垮這一站。
- **有界視窗 + O(1) 淘汰**：digest 依事件時間分桶，watermark 前進時整桶淘汰（O(1)，而非逐筆掃描）。預設 `window_seconds = 15 分鐘`，刻意**大於** 10 分鐘的 redelivery window 以吸收亂序與 retry backoff。
- **穩健性（長跑不倒）**：
  - 亂序抵達（樣本中 `ev-7f05` 就晚於 `ev-7f06` 到達）用 watermark 容忍，不會誤丟。
  - 壞資料不讓 worker 崩潰：缺 `sent_at`／格式錯誤 → 當成「現在」仍以內容去重；非 dict 記錄 → 原樣放行。
  - **Clock-skew 防護**：單筆 `sent_at` 錯得離譜（壞掉的裝置時鐘）不會把 watermark 一把推到未來、進而清空視窗讓後續重複全部漏掉。門檻用 `max_skew_seconds`（預設 `4 × window`），足以容納 deploy gap 後的正常 resume，又能擋掉明顯壞掉的日期。

## 樣本上的實際結果

| 進 | 出 | 丟棄 |
|----|----|------|
| 14 | 11 | 3（`ev-7f02` a2、`ev-7f04` a2 兩筆 retry，以及 `ev-7f01` a3 一筆晚到重送）|

- 每筆被重送的事件都**只保留最早那一份**（`attempt: 1`）。
- `ev-7f08` 的 `home` 與 `shop` **兩筆都保留**——這正是 `event_id`-only 去重會做錯的地方（它只會吐 10 筆，少一筆真實事件）。

## 該知道的取捨與後續

- **視窗參數請從 config 綁定**：`window_seconds` 我預設 15 分鐘，但它在語意上綁 `gateway.yaml` 的 `redelivery_window_minutes`。建議在組裝 pipeline 時把該值（加安全邊際）傳進來，讓兩者不會各走各的。
- **關於 128 MB 的誠實話**：純 Python 在「持續 2k/sec × 一個視窗」下約需記住 ~1.8M 個 key，以 Python object 存放約落在 100–160 MB，逼近甚至略超 128 MB 上限。若這個上限是硬性且要撐住持續尖峰，下一步有兩條路：(1) 把視窗縮到剛好蓋住 10 分鐘 redelivery window 以壓低常駐 key 數；(2) 換成 **Bloom filter** 或外部共享 store（如 Redis），前者用極小的偽陽性率換巨幅記憶體節省（代價是極低機率誤丟一筆事件）。目前實作已把成長從「無界」降到「一個視窗」，並把視窗大小做成可調旋鈕，是正確的第一步；要不要再進一步取決於實際尖峰與可接受的漏重率。
- **語意假設**：把 `(內容不含 attempt/sent_at)` 視為事件身分，等同假設「同 id 同內容」就是同一筆邏輯事件——這對 retry/redelivery 成立，也是 SDK 的 idempotency 設計意圖。

## 如何驗證

```bash
python pipeline/test_dedupe.py          # 免裝 pytest，直接跑，10/10 PASS
# 或： python -m pytest pipeline/test_dedupe.py
```

測試涵蓋：sample 上的 retry/redelivery 丟棄、`ev-7f08` 撞 id 保留、無真實事件遺失、視窗外重複放行、視窗內重複丟棄、亂序、壞欄位不崩、clock-skew 不致盲、以及長跑記憶體有界。
