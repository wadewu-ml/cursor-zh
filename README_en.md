<div align="center">
  <img src="./build/appicon.png" width="108" height="108" alt="cursor-zh icon" />
  <h1>cursor-zh</h1>
  <p>Simplified and Traditional Chinese localization for Cursor on Windows, covering Agent, Composer, and Cursor-specific settings.</p>

  <p>
    <a href="./README.md">简体中文</a> | <a href="./README_zh-TW.md">繁體中文</a> | <b>English</b>
  </p>
  <p><a href="https://github.com/wadewu-ml/cursor-zh/releases/latest">Download the latest release</a></p>
</div>

---

The official VS Code Chinese language pack does not cover all of Cursor's interface. The Agent window, Composer, and Cursor-specific settings still contain English text. `cursor-zh` builds on the official language packs to add Chinese translations for these areas.

Simplified and Traditional Chinese language packs and translation dictionaries are bundled with `cursor-zh.exe`, so you can run it without installing Node.js or Python. Use the desktop interface to apply or undo localization. The tool also updates file checksums to prevent localization changes from triggering the "Your Cursor installation appears to be corrupt" warning.

## Key Features

- **Agent and Composer**: Translates interface text in the conversation area, including mode and model selection, `@` mentions, slash command menus, change review controls, and feedback prompts.
- **Cursor-specific settings**: Adds translations for settings and descriptions in Agents, Models, Rules / Skills / Subagents, Tools & MCP, Indexing & Docs, and other settings pages.
- **Marketplace and other interfaces**: Adds translations for plugin and skill marketplace views and descriptions, the built-in browser interface, and the system tray menu.
- **Installation detection**: Detects regular and portable Cursor installations, with an option to choose the installation folder manually.
- **Content protection and restoration**: Translates interface controls and labels while skipping code editors, terminal output, user messages, and AI response text. Supports undoing localization and rolling back the current operation if file changes fail.

## How to Use

The tool runs on Windows and requires the WebView2 Runtime.

1. Download `cursor-zh.exe` from the [releases page](https://github.com/wadewu-ml/cursor-zh/releases/latest), close Cursor completely, and open the tool.
2. Check the detected installation path. If it was not found automatically, click **Change Location** (`更改位置`) and select the folder containing `Cursor.exe`.
3. Select **Simplified Chinese** (`简体中文`) or **Traditional Chinese** (`繁體中文`), then click **Apply Localization** (`应用汉化` / `應用漢化`). Wait for completion and start Cursor.

After switching languages or updating this tool, close Cursor completely and click **Update Localization** (`更新汉化` / `更新漢化`) or **Reapply** (`重新应用` / `重新應用`), as shown in the interface.

## FAQ

### Do I need to apply localization again after a Cursor update?

Yes. Cursor updates may overwrite localization files. Close Cursor completely, run this tool, and follow the interface prompts to apply localization again.

### Is a specific Cursor version required?

The bundled Simplified and Traditional Chinese language packs require VS Code engine version 1.128.0 or later. This is the engine version used by Cursor, which differs from Cursor's own version number.

### How do I switch back to English?

1. Close Cursor completely, then click **Undo Localization** (`撤销汉化` / `撤銷漢化`) in this tool to remove translation scripts and restore tray menus and file checksums.
2. The installed Chinese language pack is kept. To switch menus back to English, press `Ctrl+Shift+P` in Cursor, run `Configure Display Language`, and select `en`.

### How do I translate plugin descriptions missing from the dictionary?

The marketplace uses bundled offline dictionaries by default. Online translation is off by default; enabling it sends English descriptions missing from the dictionary to Google Translate and caches the results locally.

In Cursor, open Developer Tools (`Help -> Toggle Developer Tools`), switch to the console, run the following command, and restart Cursor to enable it:

```javascript
localStorage.setItem('cursor-zh.marketplace.online', '1');
```

To disable it, run the following command and restart Cursor:

```javascript
localStorage.setItem('cursor-zh.marketplace.online', '0');
```

### Does it support portable installations and custom paths?

Yes. It detects the `data/` folder inside a Cursor installation and supports `VSCODE_PORTABLE` for specifying the portable data folder. You can also set the installation, user data, and extensions folders with `CURSOR_INSTALL_DIR`, `CURSOR_USER_DATA_DIR`, and `CURSOR_EXTENSIONS_DIR`, respectively.

## Building from Source

Building requires Windows and Go 1.26.10 or later. Go tests also require Node.js; dictionary validation and Traditional Chinese resource generation require Python 3.

```powershell
# Build the app; output: build/bin/cursor-zh.exe
.\build.ps1

# Run Go tests
go test ./...

# Validate translation dictionaries
python localization/tools/validate_dictionary.py
```

Traditional Chinese resources are generated offline from the existing dictionaries and interface text. After editing them, install the development dependency `opencc-python-reimplemented==0.1.7`, run `python localization/tools/generate_traditional.py`, and rebuild. Users do not need to install the conversion tool.

## Disclaimer

This is an unofficial localization tool and is not affiliated with Anysphere or Cursor. It is intended for personal and educational use.
