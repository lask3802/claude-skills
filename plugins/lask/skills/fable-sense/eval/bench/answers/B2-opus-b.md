# `test_env_override_wins` 為什麼在 CI 紅、單獨跑卻綠

## 結論先講

這跟 CI 的環境變數**沒有關係**，你同事的推測是個誤導。真正的原因是**測試之間共用的全域狀態造成的順序汙染（test pollution）**：`configlib/config.py` 把設定快取在一個 module-level 全域變數裡，只在「第一次」被存取時讀一次環境變數就永久定型。整包一起跑時，另一個測試會先觸發這個快取，等到 `test_env_override_wins` 才設定 `APP_REPORT_LOCALE`，但快取早就凍結了，於是拿到舊值 `en_US` 而不是 `zh_TW`。

單獨跑那個檔案時它是行程裡第一個、也是唯一觸發快取的測試，所以環境變數剛好在讀取前設好，就過了。這不是 CI 特有的問題——在本機跑整包（`python -m pytest -q`）一樣會紅。

## 根因機制

原本的 `config.py` 長這樣：

```python
_settings = None

def get_setting(key):
    global _settings
    if _settings is None:
        _settings = _load()   # 只有第一次會讀 os.environ，之後永久快取
    return _settings[key]
```

pytest 的收集順序是檔名字母序：

1. `test_app_flags.py::test_flags_override` — 呼叫 `configure(...)`，這會第一次把 `_settings` 初始化。**此時 `APP_REPORT_LOCALE` 還沒被設**，所以 `report_locale` 被凍結成預設值 `en_US`。
2. `test_config_override.py::test_env_override_wins` — 用 monkeypatch 設了 `APP_REPORT_LOCALE=zh_TW`，再呼叫 `get_setting("report_locale")`。但 `_settings` 已經不是 `None`，`_load()` 不會再跑，於是回傳快取裡的 `en_US` → 斷言失敗。

我在本機重現，確認整包會紅、單檔會綠：

```
=== FULL SUITE (like CI) ===
.F.
E   AssertionError: assert 'en_US' == 'zh_TW'
1 failed, 2 passed

=== SINGLE FILE ===
1 passed
```

## 為什麼「CI 環境變數不同」是誤導

`.github/workflows/ci.yml` 確實設了一個環境變數，但那是 `APP_RETRY_BUDGET: "5"`，對應的是 `retry_budget`，跟 `report_locale` 完全無關。它不會影響這個測試。我在本機**完全不設任何 CI 環境變數**，只是把整包一起跑，就能重現一模一樣的失敗——這就直接證明了元兇是測試順序 / 共用全域狀態，而不是環境差異。CI 之所以看起來像「兇手」，只是因為 CI 一定跑整包，而你在本機習慣單獨跑那個檔案而已。

## 修法

我做了兩件事，一件治本、一件補強隔離：

**1. `configlib/config.py`：改成讀取當下才解析（read-time resolution），並把 `configure()` 的顯式覆寫獨立追蹤。**

環境變數不再被快取凍結，而是每次 `get_setting` 現查 `os.environ`；顯式 `configure()` 覆寫存在另一個 dict 裡並永遠最優先。這剛好符合 module docstring 與 README 寫的優先序「configure() > 環境 (APP_*) > 預設」。順帶修掉了一個真實的潛在 bug：原本只要有任何程式在環境變數設定前先碰過 `get_setting`，之後對環境變數的變更就會被默默忽略。

```python
_overrides = {}

def get_setting(key):
    if key in _overrides:
        return _overrides[key]
    env_key = "APP_" + key.upper()
    if env_key in os.environ:
        return os.environ[env_key]
    return _DEFAULTS[key]

def configure(**overrides):
    _overrides.update({k: str(v) for k, v in overrides.items()})
```

**2. 新增 `tests/conftest.py`：一個 autouse fixture，在每個測試前後清掉 `configure()` 的全域覆寫。**

這個模組本質上是行程級單例（process-wide singleton），只要有 `configure()` 就會留下跨測試的殘留狀態。加了這個 reset 之後，測試不論收集順序如何都彼此隔離，環境變數這邊本來就靠 monkeypatch 自動還原，兩者合起來讓整包測試真正做到順序無關。

## 驗證

改完後在各種情境下都綠：

```
=== FULL SUITE ===                 3 passed
=== SINGLE FILE ===                1 passed
=== SIMULATE CI ENV (APP_RETRY_BUDGET=5) ===   3 passed
=== REVERSED ORDER (汙染反向檢查) ===          3 passed
```

特別是最後那個「反向順序」——我故意把 `test_zz_reporting`（會 `configure(report_locale="fr_FR")`）排到 `test_env_override_wins` 前面跑，如果隔離沒做好，`fr_FR` 的覆寫會洩漏過去讓 env 測試失敗。現在它照樣過，證明汙染確實被封住了。

## 變更檔案

- `configlib/config.py` — 改成讀取時解析環境變數、`configure()` 覆寫獨立追蹤（治本，同時修掉環境變數被快取凍結的潛在 bug）。
- `tests/conftest.py` — 新增，autouse fixture 在每個測試前後清空全域覆寫，確保測試順序無關。
