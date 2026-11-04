<div align="center">
  <img src="./build/appicon.png" width="108" height="108" alt="cursor-zh icon" />
  <h1>cursor-zh</h1>
  <p>適用於 Windows 的 Cursor 中文漢化工具，支援簡體中文與繁體中文，補充 Agent 與專屬設定介面的中文翻譯。</p>

  <p>
    <a href="./README.md">简体中文</a> | <b>繁體中文</b> | <a href="./README_en.md">English</a>
  </p>
</div>

---

VS Code 官方中文語言套件並未涵蓋 Cursor 的所有介面，Agent 視窗、Composer 對話區和專屬設定中仍有不少英文。`cursor-zh` 在官方語言套件的基礎上，為這些介面補充中文翻譯。

工具內建中文語言套件和翻譯詞典，下載後直接執行 `cursor-zh.exe` 即可，無需安裝 Node.js 或 Python。你可以在圖形介面中套用或撤銷漢化，程式會自動更新相關檔案的校驗值，避免出現「安裝似乎損壞」提示。

## 功能特色

- **Agent 與 AI 互動介面**：翻譯 Agent 視窗、Composer 對話區、模式切換（Plan / Debug / Multitask / Ask）、`@` 提及與斜線命令選單，以及程式碼變更審查和回饋對話框中的介面文字。
- **Cursor 專屬設定**：涵蓋 General、Agents、Tab、Models、Rules / Skills / Subagents、Tools & MCP、Indexing & Docs 等頁面的設定項目與說明。
- **外掛市場與其他介面**：翻譯外掛和技能市場的介面與說明，並涵蓋內建瀏覽器和系統匣選單。
- **自動辨識安裝位置**：支援 Cursor 的一般安裝和可攜式版本，也可手動選擇安裝目錄。
- **內容保護與還原**：翻譯介面控制項和提示文字，略過程式碼編輯區、終端機輸出及 AI 對話正文；支援一鍵撤銷，並在檔案修改失敗時自動回復。

## 使用方法

1. 完全關閉 Cursor，執行 `cursor-zh.exe`。
2. 確認偵測到的安裝路徑。如未自動辨識，點選更改位置按鈕，選擇 `Cursor.exe` 所在目錄。
3. 選擇「简体中文」或「繁體中文」，點選「應用漢化」，完成後啟動 Cursor。切換語言時，關閉 Cursor 後重新套用即可。

## 常見問題

### Cursor 更新後需要重新漢化嗎？

需要。Cursor 更新可能覆蓋已修改的檔案。更新後重新執行本工具，套用漢化即可。

### 如何切回英文介面？

1. 完全關閉 Cursor，在本工具中點選「撤銷漢化」，移除翻譯指令碼並還原系統匣選單與檔案校驗值。
2. 已安裝的中文語言套件會保留。如需切回英文選單，在 Cursor 中按 `Ctrl+Shift+P`，執行 `Configure Display Language` 並選擇 `en`。

### 如何翻譯詞典尚未收錄的外掛說明？

外掛市場預設使用內建詞典離線翻譯。你也可以開啟線上翻譯，將尚未收錄的英文說明傳送至 Google 翻譯，結果會快取在本機。

在 Cursor 中開啟開發人員工具（`Help -> Toggle Developer Tools`），切換到主控台，執行以下命令後重新啟動 Cursor，即可開啟：

```javascript
localStorage.setItem('cursor-zh.marketplace.online', '1');
```

如需關閉，執行以下命令並重新啟動 Cursor：

```javascript
localStorage.setItem('cursor-zh.marketplace.online', '0');
```

### 支援可攜式版本和自訂路徑嗎？

支援。程式會辨識安裝目錄下的 `data/` 目錄，也支援透過 `VSCODE_PORTABLE` 指定可攜式資料目錄。安裝目錄、使用者資料目錄和擴充功能目錄可分別透過 `CURSOR_INSTALL_DIR`、`CURSOR_USER_DATA_DIR` 和 `CURSOR_EXTENSIONS_DIR` 指定。

## 從原始碼建置

建置需要 Windows 和 Go 1.26.10 或更新版本；執行程式需要 WebView2 Runtime。若要執行測試，還需安裝 Node.js。

```powershell
# 建置程式，輸出至 build/bin/cursor-zh.exe
.\build.ps1

# 執行測試
go test ./...
```

繁體翻譯資源由現有詞典和介面文字離線產生。修改相關文字後，安裝開發相依套件 `opencc-python-reimplemented==0.1.7`，執行 `python localization/tools/generate_traditional.py`，然後重新建置。使用者無需安裝轉換工具。

## 免責聲明

本專案為非官方漢化工具，與 Anysphere / Cursor 官方無關，僅供個人學習與日常使用。
