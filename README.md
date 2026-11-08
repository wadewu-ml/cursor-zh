<div align="center">
  <img src="./build/appicon.png" width="108" height="108" alt="cursor-zh icon" />
  <h1>cursor-zh</h1>
  <p>适用于 Windows 的 Cursor 中文汉化工具，支持简体中文与繁體中文，补充 Agent、Composer 与专属设置的中文翻译。</p>

  <p>
    <b>简体中文</b> | <a href="./README_zh-TW.md">繁體中文</a> | <a href="./README_en.md">English</a>
  </p>
  <p><a href="https://github.com/wadewu-ml/cursor-zh/releases/latest">下载最新版</a></p>
</div>

---

VS Code 官方中文语言包并不覆盖 Cursor 的全部界面，Agent 窗口、Composer 对话区和专属设置中仍有不少英文。`cursor-zh` 在官方语言包的基础上，为这些界面补充中文翻译。

工具内置简体、繁体中文语言包和翻译词典，下载后直接运行 `cursor-zh.exe`，无需安装 Node.js 或 Python。你可以在图形界面中应用或撤销汉化，程序会同步更新文件校验值，避免汉化改动触发「安装似乎损坏」提示。

## 功能特性

- **Agent 与 Composer**：翻译对话区的界面文字，包括模式与模型选择、`@` 提及、斜杠命令菜单、代码变更审查和反馈提示。
- **Cursor 专属设置**：补充 Agents、Models、Rules / Skills / Subagents、Tools & MCP、Indexing & Docs 等页面的设置项与说明翻译。
- **插件市场与其他界面**：补充插件和技能市场的界面与说明翻译，以及内置浏览器和系统托盘菜单的翻译。
- **自动识别安装位置**：支持 Cursor 的常规安装和便携版，也可手动选择安装目录。
- **内容保护与还原**：翻译界面控件和提示文字，跳过代码编辑区、终端输出、用户消息和 AI 回复正文；支持撤销汉化，文件修改失败时回滚本次操作。

## 使用方法

运行需要 Windows 和 WebView2 Runtime。

1. 从[发布页面](https://github.com/wadewu-ml/cursor-zh/releases/latest)下载 `cursor-zh.exe`，完全退出 Cursor 后运行。
2. 确认检测到的安装路径。如未自动识别，点击「更改位置」，选择 `Cursor.exe` 所在目录。
3. 选择「简体中文」或「繁體中文」，点击「应用汉化」，完成后启动 Cursor。

切换简繁语言或更新本工具后，请完全退出 Cursor，再按界面提示点击「更新汉化」或「重新应用」。

## 常见问题

### Cursor 更新后需要重新汉化吗？

需要。Cursor 更新可能覆盖汉化文件。完全退出 Cursor 后，运行本工具，按界面提示重新应用汉化即可。

### 对 Cursor 版本有要求吗？

当前内置的简繁中文语言包要求 VS Code 内核至少为 1.128.0。这是 Cursor 使用的内核版本，与 Cursor 自身的版本号不同。

### 如何切回英文界面？

1. 完全退出 Cursor，在本工具中点击「撤销汉化」，移除翻译脚本并还原托盘菜单与文件校验值。
2. 已安装的中文语言包会保留。如需切回英文菜单，在 Cursor 中按 `Ctrl+Shift+P`，执行 `Configure Display Language` 并选择 `en`。

### 如何翻译词典尚未收录的插件说明？

插件市场默认使用内置词典离线翻译。在线翻译默认关闭；开启后，会将尚未收录的英文说明发送至 Google 翻译，并将结果缓存在本地。

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

构建需要 Windows 和 Go 1.26.10 或更新版本。运行 Go 测试还需 Node.js；使用词典校验和繁体资源生成工具需要 Python 3。

```powershell
# 构建程序，输出至 build/bin/cursor-zh.exe
.\build.ps1

# 运行测试
go test ./...

# 校验翻译词典
python localization/tools/validate_dictionary.py
```

繁体翻译资源由现有词典和界面文字离线生成。修改相关文字后，安装开发依赖 `opencc-python-reimplemented==0.1.7`，运行 `python localization/tools/generate_traditional.py`，然后重新构建。用户无需安装转换工具。

## 免责声明

本项目为非官方汉化工具，与 Anysphere / Cursor 官方无关，仅供个人学习与日常使用。
