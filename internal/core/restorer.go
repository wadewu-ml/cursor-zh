package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Restorer safely reverts localization modifications.
type Restorer struct {
	fsys fs.FS
}

func NewRestorer(fsys fs.FS) *Restorer {
	return &Restorer{fsys: fsys}
}

var (
	reMarkedInjection = regexp.MustCompile(`(?s)\s*<!--\s*CURSOR_ZH_INJECTION\s*-->\s*<script\b[^>]*\bsrc=['"]\./cursor-zh-runtime\.js['"][^>]*>\s*</script>`)
	rePlainInjection  = regexp.MustCompile(`(?s)\s*<script\b[^>]*\bsrc=['"]\./cursor-zh-runtime\.js['"][^>]*>\s*</script>`)
	reStrayMarker     = regexp.MustCompile(`\s*<!--\s*CURSOR_ZH_INJECTION\s*-->`)
)

// removeInjection strips all localization script tags and markers from workbench.html.
func removeInjection(content string) string {
	content = reMarkedInjection.ReplaceAllString(content, "")
	content = rePlainInjection.ReplaceAllString(content, "")
	return reStrayMarker.ReplaceAllString(content, "")
}

func hasInjection(content string) bool {
	return strings.Contains(content, InjectionMarker) ||
		rePlainInjection.MatchString(content)
}

// Restore cleanly removes script injection and restores original tray text and checksums.
func (r *Restorer) Restore(installDir, userDataDir string, progress ProgressFunc) (*ActionResult, error) {
	det := NewDetector()
	if !det.IsValidInstallDir(installDir) {
		return nil, fmt.Errorf("无效的 Cursor 安装目录: %s", installDir)
	}
	if det.IsCursorRunning() {
		return nil, errors.New("Cursor 正在运行，请先完全退出 Cursor 再执行撤销")
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

	txn := newFileTxn()
	for _, p := range []string{wbHtmlPath, mainJsPath, prodJsonPath} {
		if err := txn.track(p); err != nil {
			return nil, err
		}
	}

	// 1. Remove HTML injection and confirm it is gone before deleting scripts,
	// otherwise Cursor would load a workbench that references a missing file.
	progress("步骤 1/3: 清理工作台注入", "正在从 workbench.html 移除脚本引用...")
	log("清理 workbench.html...")
	data, err := os.ReadFile(wbHtmlPath)
	if err != nil {
		return nil, fmt.Errorf("读取 workbench.html 失败: %w", err)
	}
	cleaned := removeInjection(string(data))
	if cleaned != string(data) {
		if err := atomicWriteFile(wbHtmlPath, []byte(cleaned), 0644); err != nil {
			return nil, txn.failWithRollback("写入 workbench.html 失败", err)
		}
	}
	if after, err := os.ReadFile(wbHtmlPath); err != nil || hasInjection(string(after)) {
		if err == nil {
			err = errors.New("脚本引用仍存在")
		}
		return nil, txn.failWithRollback("确认 workbench.html 已清理失败", err)
	}

	// 2. Restore tray menu
	progress("步骤 2/3: 还原托盘菜单与校验", "正在还原系统托盘菜单并重算 checksums...")
	log("还原系统托盘菜单...")
	installer := NewInstaller(r.fsys)
	if err := installer.patchTray(mainJsPath, true); err != nil {
		return nil, txn.failWithRollback("还原系统托盘菜单失败", err)
	}

	// 3. Update checksums
	log("重算并更新校验值...")
	count, err := installer.updateChecksums(appDir, prodJsonPath)
	if err != nil {
		return nil, txn.failWithRollback("重算校验值失败", err)
	}
	log(fmt.Sprintf("成功同步 %d 项 checksums", count))

	// 4. Remove script files last; the workbench no longer references them.
	progress("步骤 3/3: 清理注入脚本文件", "正在删除注入的 JavaScript 脚本...")
	log("删除注入脚本...")
	if err := os.Remove(targetJsPath); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("删除 %s 失败（工作台已不再引用它，可手动删除）: %w", filepath.Base(targetJsPath), err)
	}

	return &ActionResult{
		Success: true,
		Message: "已成功撤销汉化并重算校验！如需恢复英文菜单，请在 Cursor 命令面板将显示语言切换为 en。",
		Logs:    logs,
	}, nil
}
