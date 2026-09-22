# Dedupe stage — implemented

`dedupe(events)` 已在 `pipeline/dedupe.py` 實作完成，是一個 streaming generator，會丟掉重複的 event 並把其餘事件依序往下游 yield。針對真實流量 `data/events_sample.jsonl` 跑過:14 筆進、11 筆出,3 筆重送被正確丟棄,而且**沒有**把那組 id 衝突誤合併。13 個單元測試全過。

## 兩個關鍵判斷(這題真正的重點)

**1. 用「內容」去重,不是只用 `event_id`。**
一次重送(SDK retry / gateway 重投)送的是同一個邏輯事件,只有傳輸 metadata(`attempt`、`sent_at`)會變、內容不變。所以我把去重的 key 定為身分欄位的組合 —— `event_id + device_id + type + schema_v + payload` —— 而不是 `event_id` 單獨。

原因就藏在抓下來的流量裡:`ev-7f08` 出現兩次,**同一個 id、同一個 `attempt`,但 payload 不同**(`screen: home` vs `screen: shop`,來自 schema_v=2 的舊裝置)。這是 id 撞號,是兩個真實不同的使用者動作。如果照直覺用 `event_id` 去重,就會**靜默丟掉真實資料**。用內容當 key 兩筆都留下,同時仍然把真正的 retry 摺疊掉。

**2. 有界的滑動視窗,不是永不遺忘的 `set()`。**
README 的營運限制是刻意的陷阱:單一長生命週期 worker、~2k events/sec、128 MB 上限、數週不重啟。最直覺的 `seen = set()` 永不清理,會無上限成長,幾小時內就把 worker OOM 掉 —— 遠早於下次部署。

因為重複只會在 gateway 的重投視窗(`config/gateway.yaml` 的 `redelivery_window_minutes: 10`)內出現,所以只需要記得「最近看過」的事件。實作用一個以事件時間為基準的滑動視窗(預設 15 分鐘 = 10 分鐘重投視窗 + 5 分鐘餘裕,吸收亂序到達與裝置時鐘偏差),外加一個追蹤數量的硬上限當記憶體保險。

視窗長度必須綁定重投視窗這點也是陷阱:樣本裡 `ev-7f01` 的 `attempt 3` 在原事件的 **6 分 18 秒之後**才到 —— 仍在 10 分鐘視窗內,是合法重複。如果誤用 `ack_timeout_ms`(4 秒)去設視窗,就會漏抓它。

## 誠實的記憶體上限提醒(需要你拍板的一點)

有一個限制我不想含糊帶過:**在持續 2k events/sec 下,不存在同時滿足 128 MB + 2k/s + 10 分鐘 的精確 in-memory 結構。** 完整 10 分鐘視窗在尖峰時約有 ~1.2M 個 fingerprint 在飛,CPython 下每筆約 100 bytes(小 int fingerprint + float 時間戳 + dict 開銷),光這個 cache 就 ~120 MB,和 worker 其餘部分無法共存於硬性 128 MB 上限之下。

程式碼把這件事做成可調,而不是假裝它會塞得下:

- `window_seconds`(預設 900)與 `max_tracked`(預設 1_200_000)都是 keyword 參數。小規模部署用預設即可舒適運行。
- 若 worker 真的被釘死在 128 MB,選項是:(a) 調高記憶體上限;(b) 調低 `max_tracked`,接受尖峰時「有效視窗縮短、可能漏抓少數靠近 10 分鐘邊緣的重投」;或 (c) 把去重狀態外置。

**若要在尖峰下同時做到精確去重與硬性記憶體上限,正式做法是二選一:**
- **旋轉式 Bloom filter**(數個 filter 輪替成滑動視窗):1.2M 筆在 1% 誤判率下只要 ~2–3 MB。代價是誤判會丟掉真實事件 —— 對 `purchase` 這種營收事件不可接受,所以需要對高價值 type 另留精確 cache。
- **外置 TTL 儲存**(如 Redis `SETNX` + 15 分鐘 `EXPIRE`):精確、記憶體與 worker 解耦,代價是每筆多一次網路往返。

我把 in-memory 版本做到正確、有界、健壯,足以應付中等流量並在語意上完全正確;上面兩條是要撐滿完整邊緣預算時的升級路徑。這個取捨值得你確認要走哪條。

## 其他有意的設計

- **Generator 串接**:`dedupe` 是 generator,只持有視窗、不持有整條 stream,符合 pipeline 既有慣例。已驗證能和 `enrich` 串起來:`enrich(dedupe(events), region=...)`。
- **保留第一筆、維持順序**:每組重複保留最先到達的那筆。
- **健壯性**(weeks-long worker 不能被單筆壞資料弄垮):壞掉/缺失的 `sent_at` 不會拋例外,只是退回用數量上限做保護;無法 fingerprint 的項目(非 dict)原樣放行、不當掉;無法 JSON 序列化的 payload 用 `default=str` 降級處理。
- **決定性 fingerprint**:用 BLAKE2 64-bit digest(非加鹽的內建 `hash()`),在此規模下誤撞機率 ~1e-7,可忽略。

## 驗證(實際跑過的)

`python -m unittest test_dedupe -v` —— 13 tests OK。涵蓋:

- 真實樣本 14→11,丟棄集合正好是 `{(ev-7f02,2),(ev-7f04,2),(ev-7f01,3)}`
- id 撞號 `ev-7f08` 兩筆都保留
- retry 不論 `attempt`/`sent_at` 如何變都會被丟
- 6 分鐘後的重投(視窗內)會被丟;20 分鐘後(視窗外)視為新事件保留
- 亂序到達、缺欄位、壞時間戳、非 dict、不可序列化 payload
- 硬上限確實生效(容量小到會逐出時,舊 fingerprint 被淘汰)

端到端也實跑過:`enrich(dedupe(iter(rows)), region='us-edge')` 輸出 11 筆、`region` 有被標註、`ev-7f08` 兩種 payload 都在、且確認 `dedupe` 回傳的是 generator。

## 異動檔案

- `pipeline/dedupe.py` —— 實作 `dedupe()` 及 `_event_fingerprint()` / `_event_time()` 輔助函式(取代原本的 `raise NotImplementedError` stub)。
- `pipeline/test_dedupe.py` —— 新增,unittest 測試,無第三方相依。
