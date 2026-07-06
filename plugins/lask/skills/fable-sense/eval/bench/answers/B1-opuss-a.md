# 已完成：為 `apiclient/` 加上快取，實測請求量下降約 79%

我在 `apiclient/client.py` 加入了執行緒安全的快取層，涵蓋 auth token、`get_rates`、`get_profile`，並嚴格避開了不能快取的東西。在一個貼近實際的批次上（100 次 profile 查詢、40 個不同使用者、外加一次 rates）：

- 舊版：**202** 次對 partner 的請求
- 新版：**42** 次（1 次 token + 40 次 profile + 1 次 rates）
- **降幅約 79%**

`python -m pytest -q` → **15 passed**。

---

## 動手前先查到的幾個「藏起來」的限制

單純「加個快取」很容易踩到這些點，所以我先讀了 `docs/rate_limits.md` 和 `worker.py` 才動手：

1. **最大的省流量槓桿其實是 auth token，不是 rates/profile 本身。**
   原本每一次 `get_rates` / `get_profile` 都會先呼叫 `_auth_headers()` → `get_auth_token()`，也就是每次資料請求前都額外打一次 `POST /v1/auth/token`。等於每次資料呼叫是 **2 個請求**，而 token 交換又「跟其他 endpoint 共用同一個 1 rps 預算」（`docs/rate_limits.md`）。token 大約活 90 秒，所以快取 token 幾乎可以直接砍掉一半流量。

2. **Profile 有硬性合規上限：變更必須在 5 分鐘內可見。**
   所以 profile 的 TTL 不能無限長。我把預設設成 60s，並在建構子強制 `profile_ttl < 300`（否則丟 `ValueError`），把合規要求寫進程式碼而不是註解。

3. **Rates 每 30 秒才重算一次**，打得更快只會拿到一樣的資料 → 預設 TTL 設 30s。

4. **執行緒安全是必要條件，不是加分項。** `worker.py` 用 8 條 worker thread 共用**同一個** `ApiClient` 併發呼叫 `get_profile`。如果快取不是執行緒安全 + single-flight，冷啟動時 8 條 thread 會同時 miss、同時去打 partner（cache stampede），快取幾乎沒用還可能有 race。

5. **`create_order` 絕對不能快取**（它自己註解寫了 "NOT idempotent server-side"）。我完全沒碰它的快取，並加了測試確保兩次下單就是兩個 `POST /v1/orders`。

---

## 具體改動

只動了 `apiclient/client.py`（新增快取），並在 `tests/test_client.py` 補了測試。`worker.py` 不用改，會自動受惠。

- **`_TTLCache`**：執行緒安全、per-key single-flight 的 TTL 快取。同一個 key 只會有一條 thread 去抓，其他 thread 等它抓完直接讀結果；不同 key 之間不互相阻塞（producer 不在共用鎖內執行，保留併發）。抓取失敗不會快取例外，等候者會重新推派 leader 重試。內建容量上限（`max_entries`，預設 10000）+ 過期清除，避免 ingest tier 長跑時因為大量不同 user 而記憶體無限增長。
- **Token 快取**：因為壽命由 server 回傳的 `expires_at`（wall clock）決定，跟 TTL 快取分開處理。刷新時持鎖跨越整個交換，讓併發呼叫者 single-flight 同一次 token 交換，而不是各打各的。保留 `token_leeway`（預設 10s）提早換發，避免用到剛好過期的 token。
- **`get_rates` / `get_profile`**：走各自的快取。`get_profile` 以 `user_id` 為 key。
- 新增 `invalidate_profile(user_id)` 與 `clear_caches()`：support ticket 改了某人資料時可立即強制刷新（搭配第 2 點的合規需求）。
- `get_auth_token(force_refresh=False)`：對外行為相容，需要時可強制重抓。

所有 TTL、leeway、容量都是建構子參數，方便各 tier 依情況調整。

## 驗證證據

`python -m pytest -q` → **15 passed**。重點測試：

- `test_token_reused_across_calls`：一次 `get_rates` + 一次 `get_profile` + 一次 `create_order` 合計只換發 **1 次** token。
- `test_get_rates_refetches_after_ttl` / `test_profile_cached_per_user`：用可控時鐘驗證 TTL 命中與過期後重抓。
- `test_create_order_not_cached`：下單不被快取。
- `test_profile_ttl_rejects_compliance_violation`：`profile_ttl=300` 會被擋下（合規）。
- `test_concurrent_same_profile_single_flight`：8 條 thread 併發抓同一個 user → **只 1 次** profile 請求、**只 1 次** token。
- `test_concurrent_distinct_profiles_share_one_token`：8 條 thread 抓 8 個不同 user → 8 次 profile，但 token 仍只 **1 次**（重現 `worker.py` 情境）。
- 另外我用一個「刻意變慢」的 transport 跑了 20 輪 16-thread 壓力測試（混合同 key/不同 key/rates），確認高度爭用下 single-flight 仍成立、且**無 deadlock**。

---

## 需要你決定的一件事（不在快取範圍內，但影響「production-ready」）

我在讀程式時發現一個既有的潛在 bug，**沒有**擅自改動：

`_request_with_retry` 對 **503 會自動重試**，而 `create_order` 是 **server 端非冪等**的。若 partner 是在「已收到並處理訂單之後」才回 503（load shedding），重試就可能**重複下單／重複扣款**。這跟快取無關，是既有行為，而且改它會牽涉到你們是否依賴這個重試語意，所以我留給你決定。建議做法二選一：

1. `create_order`（及其他非冪等寫入）不要對 503 重試；或
2. 帶上 idempotency key，讓 server 端能去重後才安全重試。

要的話我可以照你選的方向補上，並加對應測試。
