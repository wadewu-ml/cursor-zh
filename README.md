<div align="center">
  <img src="./build/appicon.png" width="108" height="108" alt="cursor-zh icon" />
  <h1>cursor-zh</h1>
  <p>适用于 Windows 的 Cursor 中文汉化工具，支持简体中文与繁體中文，补充 Agent 与专属设置界面的中文翻译。</p>

  <p>
    <b>简体中文</b> | <a href="./README_zh-TW.md">繁體中文</a> | <a href="./README_en.md">English</a>
  </p>
</div>

---

VS Code 官方中文语言包并不覆盖 Cursor 的全部界面，Agent 窗口、Composer 对话区和专属设置中仍有不少英文。`cursor-zh` 在官方语言包的基础上，为这些界面补充中文翻译。

工具内置中文语言包和翻译词典，下载后直接运行 `cursor-zh.exe` 即可，无需安装 Node.js 或 Python。你可以在图形界面中应用或撤销汉化，程序会自动更新相关文件的校验值，避免出现「安装似乎损坏」提示。

## 功能特性

- **Agent 与 AI 交互界面**：翻译 Agent 窗口、Composer 对话区、模式切换（Plan / Debug / Multitask / Ask）、`@` 提及与斜杠命令菜单，以及代码变更审查和反馈弹窗中的界面文字。
- **Cursor 专属设置**：覆盖 General、Agents、Tab、Models、Rules / Skills / Subagents、Tools & MCP、Indexing & Docs 等页面的设置项与说明。
- **插件市场与其他界面**：翻译插件和技能市场的界面与说明，并覆盖内置浏览器和系统托盘菜单。
- **自动识别安装位置**：支持 Cursor 的常规安装和便携版，也可手动选择安装目录。
- **内容保护与还原**：翻译界面控件和提示文字，跳过代码编辑区、终端输出及 AI 聊天正文；支持一键撤销，并在文件修改出错时自动回滚。

## 使用方法

1. 完全退出 Cursor，运行 `cursor-zh.exe`。
2. 确认检测到的安装路径。如未自动识别，点击「更改位置」，选择 `Cursor.exe` 所在目录。
3. 选择「简体中文」或「繁體中文」，点击「应用汉化」，完成后启动 Cursor。切换语言时，退出 Cursor 后重新应用即可。

## 常见问题

### Cursor 更新后需要重新汉化吗？

需要。Cursor 更新可能覆盖已修改的文件。更新后重新运行本工具，点击「应用汉化」即可。

### 如何切回英文界面？

1. 完全退出 Cursor，在本工具中点击「撤销汉化」，移除翻译脚本并还原托盘菜单与文件校验值。
2. 已安装的中文语言包会保留。如需切回英文菜单，在 Cursor 中按 `Ctrl+Shift+P`，执行 `Configure Display Language` 并选择 `en`。

### 如何翻译词典尚未收录的插件说明？

插件市场默认使用内置词典离线翻译。你也可以开启在线翻译，将尚未收录的英文说明发送至 Google 翻译，结果缓存在本地。

在 Cursor 中打开开发者工具（`Help -> Toggle Developer Tools`），切换到控制台，执行以下命令后重启 Cursor，即可开启：

```javascript
localStorage.setItem('cursor-zh.marketplace.online', '1');
```

如需关闭，执行以下命令并重启 Cursor：

```javascript
localStorage.setItem('cursor-zh.marketplace.online', '0');
```

### 支持便携版和自定义路径吗？

支持。程序会识别安装目录下的 `data/` 目录，也支持通过 `VSCODE_PORTABLE` 指定便携数据目录。安装目录、用户数据目录和扩展目录可分别通过 `CURSOR_INSTALL_DIR`、`CURSOR_USER_DATA_DIR` 和 `CURSOR_EXTENSIONS_DIR` 指定。

## 源码构建

构建需要 Windows 和 Go 1.26.10 或更新版本；运行程序需要 WebView2 Runtime。若要运行测试，还需安装 Node.js。

```powershell
# 构建程序，输出至 build/bin/cursor-zh.exe
.\build.ps1

# 运行测试
go test ./...
```

繁体翻译资源由现有词典和界面文字离线生成。修改相关文字后，安装开发依赖 `opencc-python-reimplemented==0.1.7`，运行 `python localization/tools/generate_traditional.py`，然后重新构建。用户无需安装转换工具。

## 免责声明

本项目为非官方汉化工具，与 Anysphere / Cursor 官方无关，仅供个人学习与日常使用。
