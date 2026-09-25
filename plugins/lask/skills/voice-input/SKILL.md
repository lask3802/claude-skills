---
name: voice-input
description: Use when the user wants to set up, repair or tune Windows voice dictation into Claude (「裝語音輸入」「語音輸入打錯字」「CapsWriter」「/lask:voice-input」). Installs CapsWriter-Offline with Qwen3-ASR running on CPU and Taiwan-traditional output, seeds the hotword file, and verifies the chain from the client log. Windows only.
argument-hint: "[install|tune|status] [安裝路徑]"
---

# voice-input — Windows 語音輸入 Claude（CapsWriter-Offline＋Qwen3-ASR CPU）

按住 CapsLock 說話、放開，辨識文字就打進目前的輸入框（Claude Code、桌面版、網頁版都行）。
全離線、開源、不佔 GPU。這是 2026-09-26 在 Ryzen 7 9800X3D 上實測後定案的組合。

## 為什麼是這個組合

選型比過文章前三個開源工具（CapsWriter-Offline、Handy、OpenWhispr）與兩個模型。
同一句「幫我看一下 ComfyUI 的 queue，把 LoRA 的 strength 調成 0.8」：

| 模型（CPU） | 原始辨識 | 延遲 |
|---|---|---|
| SenseVoice-Small | 康 Y 的 Q 版 no strength | 0.13 s |
| Qwen3-ASR-1.7B q5_k | 康菲 UI 的 Q，把 Laura 的 Strength | 1.54 s（3.5 s 音訊）、1.94 s（11.5 s 音訊） |

SenseVoice 快，但中英混說時整段結構垮掉，熱詞救不回來；Qwen3-ASR 結構正確，
剩下的「音對字錯」（康菲 UI、Laura）正好是熱詞能修的。延遲不隨話長等比增加，
講長句時 1–2 秒幾乎無感。所以預設 Qwen3-ASR 跑 CPU。

不選的：Handy 可用（選 SenseVoice 才有中文；**Parakeet v3 不支援中文**），
OpenWhispr 本機只有 Whisper／Parakeet／Cohere，CPU 跑中文最弱。

## Arguments

- `install`（預設）：從零安裝或補齊缺的部分。
- `tune`：使用者說辨識錯字時，讀 log 找原始結果、加熱詞。
- `status`：確認 server／client 在跑、模型、最近幾次辨識。
- 第二個參數是安裝路徑。沒給時：先找既有安裝（常見 `E:\Programs\CapsWriter-Offline`、
  `%LOCALAPPDATA%\Programs\CapsWriter-Offline`），找不到才用 `%LOCALAPPDATA%\Programs\CapsWriter-Offline`，並用一行說出選了哪裡。

## install

以下 `$D` 是安裝路徑，`$DL` 是下載暫存（`$D-dl`）。每一步做完先檢查，再做下一步。

1. **找最新版與資產**。不要寫死檔名，版本會變：
   ```bash
   gh api repos/HaujetZhao/CapsWriter-Offline/releases/latest --jq '.tag_name, (.assets[]|"\(.name)\t\(.size)")'
   gh api repos/HaujetZhao/CapsWriter-Offline/releases/tags/models --jq '.assets[]|"\(.name)\t\(.size)"'
   ```
   要下載的是 `CapsWriter-Offline-<日期>.zip`（含 server＋client，Win10 64 位元以上；**不是** `-Client` 那個）
   與 models release 的 `Qwen3-ASR-1.7B-q5_k.zip`（約 2 GB）。

2. **下載要用多連線**。`gh release download` 與單線 curl 在台灣實測只有 0.1–0.4 MB/s，
   2 GB 模型要一兩個小時；本 skill 附的 `pdl.py` 分 16–24 段平行下載，實測約 10 MB/s，
   並在結尾比對總大小：
   ```bash
   B=https://github.com/HaujetZhao/CapsWriter-Offline/releases/download
   python "${CLAUDE_PLUGIN_ROOT}/skills/voice-input/pdl.py" "$B/<tag>/CapsWriter-Offline-<日期>.zip" "$DL/app.zip" 16
   python "${CLAUDE_PLUGIN_ROOT}/skills/voice-input/pdl.py" "$B/models/Qwen3-ASR-1.7B-q5_k.zip" "$DL/qwen3.zip" 24
   ```
   兩個都放背景跑。每個都要等到印出 `OK <檔名> <大小>` 才算完成；只看到幾個 OK 不代表每個都好了。

3. **解壓**。app zip 裡有一層 `CapsWriter-Offline/`，把它搬成 `$D`。
   模型解到 `$D/models/Qwen3-ASR/`，得到 `$D/models/Qwen3-ASR/Qwen3-ASR-1.7B/` 下三個檔：
   `qwen3_asr_encoder_frontend.onnx`、`qwen3_asr_encoder_backend.onnx`、`qwen3_asr_llm.gguf`。
   路徑以 `config_server.py` 的 `qwen3_asr_gguf_dir` 為準，新版若改了就照新版放。

4. **改設定**。先備份成 `.orig`。用 Python 改並保留原本的換行（`newline=''`），
   否則 CRLF 被改寫，之後 diff 會整份標紅。每個替換都要斷言「剛好命中一次」，
   沒命中代表上游改了設定格式，停下來讀檔案，不要猜：
   - `config_server.py`：`model_type = 'qwen_asr'`；`class Qwen3ASRGGUFArgs` 區塊內 `llm_use_gpu = False`
     （只改這個區塊，其他模型區塊也有同名欄位）。
   - `config_client.py`：`traditional_convert = True`、`traditional_locale = 'zh-tw'`。

5. **種熱詞**。在 `$D/hot.txt` 檔尾加（檔尾沒有換行時先補一個）：
   ```
   # ====== 使用者常用 ======
   ComfyUI | 康 Y | 康Y | 康飛 UI | 康飞 UI | 康菲 UI
   LoRA | Laura | 蘿拉 | 萝拉 | 羅拉 | 罗拉
   queue
   strength
   Stability Matrix
   ```
   上游預設 `hot.txt` 已含 `Claude`、`Claude Code`、`CUDA` 等。

6. **啟動**。兩個程式都要以 `$D` 當工作目錄，先 server 後 client：
   ```powershell
   Start-Process "$D\start_server.exe" -WorkingDirectory $D; Start-Sleep 15
   Start-Process "$D\start_client.exe" -WorkingDirectory $D
   ```
   通過條件：`logs/server_latest.log` 有 `模型加载完成，ASR 服务就绪` 且只出現 `CPU compute buffer`；
   `logs/client_latest.log` 有 `找到音频设备: <麥克風名>` 與 `WebSocket 建立成功`。

7. **端到端驗證要使用者開口**。自己測不了麥克風，不要宣稱整條鏈通了。請使用者把游標放在
   Claude 輸入框，按住 CapsLock 念上面那句測試句，然後讀 client log：
   ```bash
   grep -E '录音任务完成|最终识别结果|热词替换后|当前活动窗口' "$D/logs/client_latest.log" | tail -4
   ```
   `最终识别结果` 是模型原始輸出（簡體），`热词替换后` 是繁體＋熱詞修正後實際打出的字。
   兩行都要對照，才分得出是模型聽對還是熱詞修的。

8. **開機自啟動要問**。預設不裝；使用者同意才在 `shell:startup` 放兩個捷徑（工作目錄設 `$D`）。
   下載暫存 `$DL`（約 2–3 GB）驗證完後可刪，刪前說一聲。

## tune

使用者說「打錯字」時，先讀 log 的 `最终识别结果`，再依錯法處理：

| 錯法 | 例子 | 處理 |
|---|---|---|
| 音對、字拼錯 | 康菲 UI→ComfyUI、Laura→LoRA | `hot.txt` 加 `正確詞 \| 錯法`；存檔 3 秒後自動重載，看 log 有 `热词文件已自动重新加载` |
| 同音中文字 | 講話→講畫 | 熱詞修不了，請使用者送出前掃一眼 |
| 多個詞糊成一團 | 的 queue，把 LoRA→的 Q 版 no | 模型能力上限；SenseVoice 常見，Qwen3-ASR 少見 |
| 太短的英文 | queue→Q | 不要把單字母或常用詞（如「Q版」）設成別名，會誤換 |

`hot-server.txt` 沒有熱重載，改了要重啟 server。規則式替換（正規表示式）放 `hot-rule.txt`。

## 已知行為

- 輕按 CapsLock 仍是大小寫切換；按住超過 0.3 秒（`threshold`）才錄音。滑鼠側鍵 X2 也能錄。
- 8 個詞以內的短句會去掉句尾標點（v2.6 行為）。
- 預設用模擬打字輸出。若某個程式漏字或被輸入法攔，把它的 exe 名加進 `config_client.py` 的 `paste_apps` 改走剪貼簿。
- server 預設監聽 `0.0.0.0:6016`，區網看得到；只要本機用可改 `addr = '127.0.0.1'`。
- 想更快可改 `llm_use_gpu = True`（約 2 GB VRAM）；與 ComfyUI 等共用 GPU 時會搶，預設不開。
