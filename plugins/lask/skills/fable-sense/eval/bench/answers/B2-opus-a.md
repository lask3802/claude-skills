# 診斷結果與修復

## 結論先講

問題**不是** CI 與開發機的環境變數不同造成的 —— 那位同事的推測是個 red herring。真正的原因是 `configlib/config.py` 裡有一個**行程層級（process-wide）的全域快取 `_settings`，在跨測試之間洩漏了狀態**。這是測試隔離問題，不是環境問題。

`test_env_override_wins` 之所以「單獨跑這個檔案就過、在 CI 跑整套就紅」，是因為 CI 一定會跑完整測試套件，而套件裡有另一個測試搶先污染了那個快取。

## 實際發生的事

1. `get_setting()` 第一次被呼叫時會執行 `_load()`，把當下的環境變數讀進全域 `_settings`，**之後就一直用這份快取，不會再重讀環境**。`configure()` 也一樣，若 `_settings` 還是 `None` 就會先觸發 `_load()`。

2. pytest 預設依檔名字母序收集：`test_app_flags.py` → `test_config_override.py` → `test_zz_reporting.py`。所以 `test_app_flags.py` 的 `test_flags_override()` **最先跑**，它呼叫了 `configure(...)`，在此時就把 `_settings` 快取定型了 —— 而那個時間點並沒有 `APP_REPORT_LOCALE`。

3. 輪到 `test_env_override_wins` 時，它用 `monkeypatch.setenv("APP_REPORT_LOCALE", "zh_TW")` 設好環境變數，但因為 `_settings` 已經不是 `None`，`_load()` 再也不會被呼叫，環境變數被**默默忽略**，`get_setting("report_locale")` 回傳的是快取裡的預設值 `en_US`，於是斷言失敗。

4. 單獨跑 `tests/test_config_override.py` 時，它是唯一（也是第一個）測試，快取一開始是空的，monkeypatch 設好環境後 `_load()` 才第一次執行，所以會過。差別從頭到尾是「單檔 vs. 整套」，不是「本機 vs. CI」。

## 我實際驗證過的證據

- 把 CI 的環境變數帶進來、但只跑該檔（`APP_RETRY_BUDGET=5 python -m pytest -q tests/test_config_override.py`）→ **仍然通過**。證明 `APP_RETRY_BUDGET` 這個環境差異跟這個失敗無關（它影響的是 `retry_budget`，跟 `report_locale` 八竿子打不著）。
- `python -m pytest -q tests/test_config_override.py tests/test_zz_reporting.py`（沒有污染源在前）→ 兩個都過。
- `python -m pytest -q tests/test_app_flags.py tests/test_config_override.py`（污染源在前）→ **重現失敗**，錯誤正是 `assert 'en_US' == 'zh_TW'`。這就在本機重現了 CI 的紅燈，跟 CI 無關。

## 修復方式

根因是「共用的全域快取在測試間洩漏」，所以修法針對隔離，而不是去改一個測試的斷言（那只會把地雷埋回去 —— 任何在 `configure()`/`get_setting()` 之後才跑、又依賴乾淨狀態的測試都會踩到）。

1. 在 `configlib/config.py` 新增一個公開的 `reset()`，把快取清成 `None`，讓下次存取重新讀環境：

   ```python
   def reset():
       global _settings
       _settings = None
   ```

2. 新增 `tests/conftest.py`，用一個 `autouse` fixture 在**每個**測試前後都 `reset()`，讓每個測試都拿到乾淨、未快取的設定，與收集順序無關：

   ```python
   @pytest.fixture(autouse=True)
   def _isolate_config():
       reset()
       yield
       reset()
   ```

這樣同時修好了整組測試的隔離性，不只是回報的那一個。生產環境的行為完全不變 —— 快取照舊，`reset()` 純粹是給測試用的鉤子。

## 驗證結果

`python -m pytest -q` 全部通過（預設順序、帶 CI 環境變數 `APP_RETRY_BUDGET=5`、單獨跑該檔、以及污染源在前的順序都試過）：

```
...                                                                      [100%]
3 passed
```

## 附帶一提（可選）

現在的設計是「第一個碰到設定的程式碼會把當下環境凍結起來」。生產環境通常沒問題（環境變數在啟動時就固定了），但如果你們希望這種順序相依性更難踩雷，可以考慮讓 `get_setting()` 不做行程層級快取、或在讀 env 時每次即時查詢。目前的修復已足以讓 CI 穩定綠燈，這點只是後續可考慮的方向，不是必要。

## 變更檔案

- `configlib/config.py` —— 新增 `reset()`。
- `tests/conftest.py` —— 新增 autouse fixture，每個測試前後重置設定快取。
