# `test_env_override_wins` 修好了 — 但原因不是 CI 的環境變數

## 結論先講

真正的原因是**測試之間共用的 process 全域狀態 + 測試執行順序**,跟 CI 設了不同環境變數**無關**。你同事的推測方向不對(我用實驗證明了,見下)。

`configlib/config.py` 把設定 cache 在一個 module 級的全域變數 `_settings` 裡,只在「第一次」被存取時載入一次,之後永遠不再重新讀取環境變數。跑整個測試套件時,排在前面的 `test_flags_override`(在 `tests/test_app_flags.py`)會先呼叫 `configure()`,把這個 cache 用預設值 `report_locale="en_US"` 初始化。等輪到 `test_env_override_wins` 時,它雖然用 `monkeypatch.setenv("APP_REPORT_LOCALE", "zh_TW")` 設了環境變數,但 `get_setting` 直接回傳那個已經 cache 好的舊值,因為 `_load()` 不會再被呼叫 —— 所以拿到 `en_US`,斷言失敗。

你單獨跑那個檔案時會過,是因為那時沒有別的測試先污染 cache:`_settings` 還是 `None`,`get_setting` 觸發 `_load()`,讀到你剛設好的 `APP_REPORT_LOCALE=zh_TW`,自然就過了。

這其實**不是 CI vs. 本機**的差別,而是**單檔 vs. 整套**的差別。你在本機跑整套一樣會紅 —— 只是你之前只單獨跑了那個檔案。

## 為什麼不是環境變數(有實測佐證)

CI 的 `ci.yml` 確實有設 `APP_RETRY_BUDGET: "5"`,但那影響的是 `retry_budget`,跟這個測試檢查的 `report_locale` 八竿子打不著。我實際驗過:

| 實驗 | 結果 |
|---|---|
| 整套測試(照 CI 的跑法) | **FAIL**(`assert 'en_US' == 'zh_TW'`) |
| 整套測試 **加上** CI 的 `APP_RETRY_BUDGET=5` | **一模一樣地 FAIL** —— 環境變數毫無影響 |
| 把失敗的測試排到**最前面**跑 | **全過** —— 證明是「順序」問題 |
| 只跑 `test_app_flags.py` 再跑 `test_config_override.py`(本機) | **FAIL** —— 本機就能重現,無關 CI |
| 只單獨跑該檔案 | **PASS** |

換句話說:設不設 CI 那個環境變數,失敗都一樣;只要調整測試順序,失敗就消失。凶手是共用狀態,不是環境。

## 修法

問題本質是:config 是個 process 級、載入一次就 cache 的單例,而測試會逐案去操作環境變數 / 呼叫 `configure()`,卻沒有在測試之間把它清乾淨,於是誰先跑就決定了結果。正解是**讓每個測試都從乾淨的 config 狀態開始**。

改了兩個地方:

1. **`configlib/config.py`** — 新增一個 `reset()` function,把 cache 清成 `None`,讓下次存取時重新從環境變數 + 預設值載入。這不改變任何現有行為,只是給模組一個正式的重置入口。

2. **`tests/conftest.py`(新增)** — 一個 `autouse` fixture,在每個測試前後都呼叫 `config.reset()`。這樣整個套件就與執行順序無關了。

我刻意沒有去動 `_load()` 把環境變數改成「每次即時讀取」,因為對正式環境來說「載入一次就 cache」是合理且刻意的設計(production 的環境變數不會中途變動),真正的問題只在於測試共用了這個單例卻沒隔離。用 fixture 隔離才是對症下藥,而且能涵蓋所有排列順序(包括未來若有 `configure(report_locale=...)` 排在前面的情況)。

## 驗證

修好後我把各種順序都跑過:

- 整套 · 自然順序:**3 passed**
- 整套 · 加上 CI 的 `APP_RETRY_BUDGET=5`:**3 passed**
- 反向順序:**3 passed**
- 原本會失敗的「污染者先跑」順序:**2 passed**
- 單獨跑該檔案:**1 passed**
- 整套連跑 3 次確認無殘留污染:每次都 **3 passed**

`python -m pytest -q` 現在整套是綠的,而且不再受測試順序影響。

## 附帶一提(可選,不影響這次修復)

如果你們哪天希望「程式執行中途改環境變數也能即時生效」,那就得改 `config.py` 的 cache 策略(例如只 cache 明確的 `configure()` overrides,環境變數每次即時讀)。但那是另一個設計決策,不是這次 CI 紅燈的原因,我沒有動它。
