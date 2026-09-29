---
description: 把剪貼簿內容當作貼上的文字附進訊息（繞過 herdr 等終端的逐字貼上）
argument-hint: "[對貼上內容的指示]"
allowed-tools: Bash
disable-model-invocation: true
---
以下是使用者從剪貼簿貼上的內容：

<clipboard>
!`pwsh -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw" 2>/dev/null || powershell.exe -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw" 2>/dev/null || pbpaste 2>/dev/null || wl-paste --no-newline 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || echo "(讀不到剪貼簿：找不到 pwsh / powershell.exe / pbpaste / wl-paste / xclip)"`
</clipboard>

$ARGUMENTS
