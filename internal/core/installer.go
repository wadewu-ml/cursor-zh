package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// PrivateExtensions map for Cursor internal extensions
var PrivateExtensions = map[string]map[string]any{
	"anysphere.cursor-always-local": {
		"package": map[string]any{
			"displayName": "Cursor 始终本地",
			"description": "为 Cursor 提供实验性本地功能。",
		},
	},
	"anysphere.cursor-retrieval": {
		"package": map[string]any{
			"displayName": "Cursor 检索",
			"description": "处理 Cursor 的索引与检索能力。",
		},
	},
	"anysphere.cursor-shadow-workspace": {
		"package": map[string]any{
			"displayName": "Cursor 影子工作区",
			"description": "管理一个供 AI 智能体在展示前整理代码的隐藏本地窗口。",
		},
	},
	"inspecta.inspecta-ide-integration": {
		"package": map[string]any{
			"displayName": "Inspecta IDE 集成",
			"description": "将 Inspecta CSS 更改与 Cursor IDE 和 VS Code AI 智能体集成。",
		},
	},
}

// ProgressFunc is called to report progress to caller.
type ProgressFunc func(stage string, detail string)

// Installer coordinates the injection of localization assets into Cursor.
type Installer struct {
	fsys fs.FS
}

func NewInstaller(fsys fs.FS) *Installer {
	return &Installer{fsys: fsys}
}

// Apply executes the transactional localization setup.
func (in *Installer) Apply(installDir, userDataDir string, progress ProgressFunc) (*ActionResult, error) {
	det := NewDetector()
	if !det.IsValidInstallDir(installDir) {
		return nil, fmt.Errorf("无效的 Cursor 安装目录: %s", installDir)
	}
	if det.IsCursorRunning() {
		return nil, errors.New("Cursor 正在运行，请先完全退出 Cursor 再应用汉化")
	}

	var logs []string
	log := func(msg string) {
		logs = append(logs, msg)
	}

	if progress == nil {
		progress = func(_, _ string) {}
	}

	appDir := filepath.Join(installDir, "resources", "app")
	wbDir := filepath.Join(appDir, "out", "vs", "code", "electron-sandbox", "workbench")
	wbHtmlPath := filepath.Join(wbDir, "workbench.html")
	targetJsPath := filepath.Join(wbDir, LocalizationJSFile)
	mainJsPath := filepath.Join(appDir, "out", "main.js")
	prodJsonPath := filepath.Join(appDir, "product.json")
	argvPath, err := cursorArgvPath(installDir)
	if err != nil {
		return nil, err
	}

	// Snapshot every file this operation may touch so any failure rolls back cleanly.
	txn := newFileTxn()
	for _, p := range []string{
		targetJsPath, wbHtmlPath, mainJsPath, prodJsonPath,
		argvPath,
		filepath.Join(userDataDir, "languagepacks.json"),
	} {
		if err := txn.track(p); err != nil {
			return nil, err
		}
	}

	// 1. Build JavaScript runtime first: nothing is touched if the build fails.
	progress("步骤 1/4: 构建翻译引擎与词典", "正在组装 cursor-zh-runtime.js...")
	jsContent, err := NewBuilder(in.fsys).BuildJavaScript()
	if err != nil {
		return nil, fmt.Errorf("构建翻译运行时失败: %w", err)
	}

	// 2. Language pack & locale configuration (required)
	profile := resourceLanguage(in.fsys)
	progress("步骤 2/4: 准备"+profile.name+"语言包", "正在配置显示语言与语言包...")
	log("配置 argv.json 显示语言...")
	if err := in.setupLocale(installDir); err != nil {
		return nil, txn.failWithRollback("配置 argv.json 失败", err)
	}

	log("安装内置官方中文语言包...")
	if err := in.installLanguagePack(installDir, userDataDir, log); err != nil {
		return nil, txn.failWithRollback("安装官方"+profile.name+"语言包失败", err)
	}

	log("更新 Cursor 私有扩展翻译桥接...")
	if err := in.setupPrivateExtensions(userDataDir, txn, log); err != nil {
		return nil, txn.failWithRollback("写入私有扩展翻译桥接失败", err)
	}

	// 3. Write runtime and inject HTML
	progress("步骤 3/4: 注入工作台入口", "正在写入脚本并更新 workbench.html...")
	log(fmt.Sprintf("写入运行时脚本: %s", targetJsPath))
	if err := atomicWriteFile(targetJsPath, []byte(jsContent), 0644); err != nil {
		return nil, txn.failWithRollback("写入翻译脚本失败", err)
	}
	log("注入 workbench.html...")
	if err := in.injectHTML(wbHtmlPath); err != nil {
		return nil, txn.failWithRollback("注入 workbench.html 失败", err)
	}

	// 4. Tray menu patch and checksums
	progress("步骤 4/4: 修补托盘菜单与校验", "正在更新系统托盘菜单与 product.json checksums...")
	log("更新系统托盘菜单...")
	if err := in.patchTray(mainJsPath, false); err != nil {
		return nil, txn.failWithRollback("更新系统托盘菜单失败", err)
	}

	log("重算并更新 product.json 校验值...")
	count, err := in.updateChecksums(appDir, prodJsonPath)
	if err != nil {
		return nil, txn.failWithRollback("更新校验值失败", err)
	}
	log(fmt.Sprintf("成功同步 %d 项 checksums", count))

	return &ActionResult{
		Success: true,
		Message: "汉化已成功应用！请启动 Cursor 查看效果。",
		Logs:    logs,
	}, nil
}

func (in *Installer) installLanguagePack(installDir, userDataDir string, log func(string)) error {
	profile := resourceLanguage(in.fsys)
	vsixData, err := fs.ReadFile(in.fsys, profile.vsix)
	if err != nil {
		return fmt.Errorf("读取嵌入 VSIX 失败: %w", err)
	}

	tmpVsix, err := os.CreateTemp("", "vscode-lang-*.vsix")
	if err != nil {
		return err
	}
	defer os.Remove(tmpVsix.Name())
	if _, err := tmpVsix.Write(vsixData); err != nil {
		tmpVsix.Close()
		return err
	}
	tmpVsix.Close()

	out, err := runCursorCLI(installDir, "--install-extension", tmpVsix.Name(), "--force",
		fmt.Sprintf("--user-data-dir=%s", userDataDir),
		fmt.Sprintf("--extensions-dir=%s", NewDetector().ResolveExtensionsDir(installDir)))
	if err != nil {
		log(fmt.Sprintf("安装扩展命令输出: %s", strings.TrimSpace(string(out))))
		return err
	}
	detector := NewDetector()
	detector.Locale = profile.locale
	if !detector.languagePackInstalled(installDir) {
		return fmt.Errorf("安装命令已返回，但未在扩展目录找到%s语言包", profile.name)
	}
	log("官方" + profile.name + "扩展已成功安装")
	return nil
}

// runCursorCLI runs Cursor's bundled CLI (Cursor.exe in Node mode + out/cli.js). Replaceable in tests.
var runCursorCLI = func(installDir string, args ...string) ([]byte, error) {
	exe := filepath.Join(installDir, "Cursor.exe")
	cli := filepath.Join(installDir, "resources", "app", "out", "cli.js")
	cmd := exec.Command(exe, append([]string{cli}, args...)...)
	cmd.Env = append(os.Environ(), "ELECTRON_RUN_AS_NODE=1", "VSCODE_DEV=")
	hideWindow(cmd)
	return cmd.CombinedOutput()
}

func (in *Installer) setupPrivateExtensions(userDataDir string, txn *fileTxn, log func(string)) error {
	lpPath := filepath.Join(userDataDir, "languagepacks.json")
	data, err := os.ReadFile(lpPath)
	if os.IsNotExist(err) {
		log("languagepacks.json 尚未生成，私有扩展桥接将在下次应用时写入")
		return nil
	}
	if err != nil {
		return err
	}

	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("解析 languagepacks.json 失败: %w", err)
	}
	profile := resourceLanguage(in.fsys)
	zhRaw, ok := raw[profile.locale].(map[string]any)
	if !ok {
		return fmt.Errorf("languagepacks.json 未登记 %s 语言包", profile.locale)
	}
	transRaw, ok := zhRaw["translations"].(map[string]any)
	if !ok {
		transRaw = make(map[string]any)
		zhRaw["translations"] = transRaw
	}
	vsMain, ok := transRaw["vscode"].(string)
	if !ok || vsMain == "" {
		return errors.New("languagepacks.json 缺少 vscode 主翻译路径")
	}

	transDir := filepath.Dir(vsMain)
	if err := os.MkdirAll(transDir, 0755); err != nil {
		return err
	}

	for extId, content := range PrivateExtensions {
		targetPath := filepath.Join(transDir, extId+".i18n.json")
		wrapper := map[string]any{
			"":         []string{"Generated by cursor-zh for Cursor private extensions."},
			"version":  "1.0.0",
			"contents": content,
		}
		wrappedBytes, err := json.MarshalIndent(wrapper, "", "  ")
		if err != nil {
			return err
		}
		if profile.locale == TraditionalChinese {
			wrappedBytes = []byte(TraditionalText(string(wrappedBytes)))
		}
		if err := txn.track(targetPath); err != nil {
			return err
		}
		if err := atomicWriteFile(targetPath, append(wrappedBytes, '\n'), 0644); err != nil {
			return err
		}
		transRaw[extId] = targetPath
	}

	newData, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	if err := atomicWriteFile(lpPath, append(newData, '\n'), 0644); err != nil {
		return err
	}
	// Cursor reuses tcf.json when the language-pack hash and commit are unchanged.
	// Refresh that file in place; keep the compiled messages and unrelated caches.
	if hash, _ := zhRaw["hash"].(string); hash != "" {
		cacheDir := filepath.Join(userDataDir, "clp", hash+"."+profile.locale)
		if _, err := os.Stat(cacheDir); err == nil {
			cachePath := filepath.Join(cacheDir, "tcf.json")
			if err := txn.track(cachePath); err != nil {
				return err
			}
			translations, err := json.Marshal(transRaw)
			if err != nil {
				return err
			}
			if err := atomicWriteFile(cachePath, translations, 0644); err != nil {
				return err
			}
			log("已同步已有语言包翻译缓存")
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	log("私有扩展桥接已写入 languagepacks.json")
	return nil
}

func (in *Installer) injectHTML(htmlPath string) error {
	data, err := os.ReadFile(htmlPath)
	if err != nil {
		return err
	}
	content := string(data)

	content = removeInjection(content)

	injection := fmt.Sprintf("\n\t%s\n\t<script src=\"./%s\"></script>\n", InjectionMarker, LocalizationJSFile)
	if strings.Contains(content, "</body>") {
		content = strings.Replace(content, "</body>", injection+"</body>", 1)
	} else if strings.Contains(content, "</html>") {
		content = strings.Replace(content, "</html>", injection+"</html>", 1)
	} else {
		content = content + injection
	}

	return atomicWriteFile(htmlPath, []byte(content), 0644)
}

func (in *Installer) patchTray(mainJsPath string, reverse bool) error {
	trayData, err := fs.ReadFile(baseResources(in.fsys), "localization/Tray_Dictionary.json")
	if err != nil {
		return fmt.Errorf("读取托盘词典失败: %w", err)
	}
	var raw struct {
		Replacements [][]string `json:"replacements"`
	}
	if err := json.Unmarshal(trayData, &raw); err != nil {
		return fmt.Errorf("解析托盘词典失败: %w", err)
	}

	contentBytes, err := os.ReadFile(mainJsPath)
	if err != nil {
		return err
	}
	content := string(contentBytes)

	for _, pair := range raw.Replacements {
		if len(pair) < 2 {
			continue
		}
		content = strings.ReplaceAll(content, TraditionalText(pair[1]), pair[0])
		content = strings.ReplaceAll(content, pair[1], pair[0])
	}
	if !reverse {
		for _, pair := range raw.Replacements {
			if len(pair) >= 2 {
				content = strings.ReplaceAll(content, pair[0], languageText(resourceLanguage(in.fsys).locale, pair[1]))
			}
		}
	}
	if content != string(contentBytes) {
		return atomicWriteFile(mainJsPath, []byte(content), 0644)
	}
	return nil
}

func (in *Installer) updateChecksums(appDir, prodJsonPath string) (int, error) {
	data, err := os.ReadFile(prodJsonPath)
	if err != nil {
		return 0, err
	}
	var prod map[string]any
	if err := json.Unmarshal(data, &prod); err != nil {
		return 0, err
	}
	checksums, ok := prod["checksums"].(map[string]any)
	if !ok || len(checksums) == 0 {
		return 0, errors.New("product.json 缺少 checksums")
	}

	updated := 0
	for key := range checksums {
		target, err := resolveChecksumTarget(appDir, key)
		if err != nil {
			return 0, fmt.Errorf("校验目标 %s 不可用: %w", key, err)
		}
		hash, err := CalculateFileHash(target)
		if err != nil {
			return 0, fmt.Errorf("计算 %s 校验值失败: %w", key, err)
		}
		checksums[key] = hash
		updated++
	}

	out, err := json.MarshalIndent(prod, "", "\t")
	if err != nil {
		return 0, err
	}
	if err := atomicWriteFile(prodJsonPath, append(out, '\n'), 0644); err != nil {
		return 0, err
	}
	return updated, nil
}

func atomicWriteFile(filePath string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(filePath)
	tmpFile, err := os.CreateTemp(dir, "tmp-write-*")
	if err != nil {
		return err
	}
	tmpName := tmpFile.Name()
	defer func() {
		_ = tmpFile.Close()
		_ = os.Remove(tmpName)
	}()

	if _, err := io.Copy(tmpFile, bytes.NewReader(data)); err != nil {
		return err
	}
	if err := tmpFile.Chmod(perm); err != nil {
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	return os.Rename(tmpName, filePath)
}
