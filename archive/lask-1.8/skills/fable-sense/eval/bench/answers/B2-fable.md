# test_env_override_wins 調查結果與修復

**TL;DR：跟 CI 的環境變數無關。這是共享全域狀態造成的測試順序依賴（test-ordering bug）——`configlib` 的 module-level settings cache 被先跑的測試填住，之後的 `monkeypatch.setenv` 就再也讀不到了。已修復，全部測試在任何順序下都通過。**

## 為什麼不是 CI 環境變數

同事的推論可以直接用三個實驗排除：

1. 在本機（完全沒有設任何 CI 環境變數）跑完整測試套件 `python -m pytest -q`，會出現**跟 CI 一模一樣的失敗**（`assert 'en_US' == 'zh_TW'`）。所以這不是 CI 才有的問題——只是大家在本機都只單獨跑那個檔案，沒跑過完整套件。
2. 把 CI 設的 `APP_RETRY_BUDGET=5` 加上再單獨跑 `tests/test_config_override.py`，照樣通過。這個變數只影響 `retry_budget`，沒有任何測試斷言它。
3. 把測試檔順序調換、讓 `test_config_override.py` 先跑，即使帶著 CI 的環境變數，三個測試全部通過。

結論：失敗與否只取決於**測試執行順序**，跟環境變數完全無關。

## 真正的機制

`configlib/config.py` 把設定存在 module-level 的 `_settings`，第一次呼叫 `get_setting()` 或 `configure()` 時才 lazy load（`_load()` 在那個瞬間讀一次 `os.environ`），之後永遠回傳 cache。

pytest 依字母順序收集檔案：`test_app_flags.py` → `test_config_override.py` → `test_zz_reporting.py`。

1. `test_app_flags.py::test_flags_override` 先跑，呼叫 `configure(...)`，此時 `_settings` 被填入——`report_locale` 快照為預設值 `"en_US"`（那時 `APP_REPORT_LOCALE` 還不存在）。
2. 接著 `test_env_override_wins` 用 `monkeypatch.setenv("APP_REPORT_LOCALE", "zh_TW")` 設環境變數，但 `get_setting()` 看到 `_settings is not None` 就直接回 cache，**永遠不會再讀環境**，於是拿到 `"en_US"`。

單獨跑該檔案時是全新 process、cache 是空的，`_load()` 在 monkeypatch 之後才執行，所以每次都過——這就是「本機單跑綠、CI 全跑紅」的完整解釋。

## 修復內容

問題的本質是測試之間共享了全域狀態（`test_app_flags` 和 `test_zz_reporting` 的 `configure()` 也同樣會互相汙染），所以修在測試隔離層，而不是只補救單一測試：

- `configlib/config.py`：新增公開的 `reset()`，清掉 cache，下次存取時重新讀取 defaults + 環境變數。優先序語意（configure > env > defaults）不變。
- `tests/conftest.py`（新檔）：autouse fixture 在每個測試前後呼叫 `config.reset()`，確保每個測試都從乾淨狀態開始。

## 驗證

- `python -m pytest -q` → 3 passed
- `APP_RETRY_BUDGET=5 python -m pytest -q`（模擬 CI 環境）→ 3 passed
- `python -m pytest -q tests/test_config_override.py`（原本的本機跑法）→ 1 passed

順帶一提：CI 的 `APP_RETRY_BUDGET: "5"` 可以留著，它現在（和以前一樣）對測試結果沒有影響。
