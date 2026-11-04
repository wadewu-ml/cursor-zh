package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const (
	InjectionMarker    = "<!-- CURSOR_ZH_INJECTION -->"
	LocalizationJSFile = "cursor-zh-runtime.js"
)

// Detector handles discovery and state inspection of Cursor installations.
type Detector struct {
	// ExpectedBuildHash is the build marker hash of the localization embedded in this binary.
	// When set, an installed script with a different hash is reported as outdated.
	ExpectedBuildHash string
}

// cursorRunningCheck is replaceable in tests.
var cursorRunningCheck = defaultIsCursorRunning

// LanguagePackExtensionID is the official Simplified Chinese language pack.
const LanguagePackExtensionID = "ms-ceintl.vscode-language-pack-zh-hans"

func NewDetector() *Detector {
	return &Detector{}
}

// ResolveInstallDir finds the most likely Cursor installation directory.
func (d *Detector) ResolveInstallDir(override string) string {
	if override != "" && d.IsValidInstallDir(override) {
		return filepath.Clean(override)
	}

	envPaths := []string{
		os.Getenv("CURSOR_INSTALL_DIR"),
		os.Getenv("CURSOR_ROOT"),
	}
	for _, p := range envPaths {
		if p != "" && d.IsValidInstallDir(p) {
			return filepath.Clean(p)
		}
	}

	localAppData := os.Getenv("LOCALAPPDATA")
	programFiles := os.Getenv("PROGRAMFILES")
	programFilesX86 := os.Getenv("PROGRAMFILES(X86)")

	candidates := []string{
		filepath.Join(localAppData, "Programs", "cursor"),
		filepath.Join(programFiles, "Cursor"),
		filepath.Join(programFilesX86, "Cursor"),
		"D:\\programs\\cursor",
	}

	for _, c := range candidates {
		if c != "" && d.IsValidInstallDir(c) {
			return filepath.Clean(c)
		}
	}

	return ""
}

func portableDataDir(installDir string) string {
	if portable := os.Getenv("VSCODE_PORTABLE"); portable != "" {
		return filepath.Clean(portable)
	}
	portable := filepath.Join(installDir, "data")
	if installDir != "" {
		if info, err := os.Stat(portable); err == nil && info.IsDir() {
			return portable
		}
	}
	return ""
}

// ResolveUserDataDir finds Cursor's user data directory.
func (d *Detector) ResolveUserDataDir(installDir, override string) string {
	if override != "" {
		return filepath.Clean(override)
	}
	if env := os.Getenv("CURSOR_USER_DATA_DIR"); env != "" {
		return filepath.Clean(env)
	}
	if portable := portableDataDir(installDir); portable != "" {
		return filepath.Join(portable, "user-data")
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		return filepath.Join(appData, "Cursor")
	}
	userProfile := os.Getenv("USERPROFILE")
	return filepath.Join(userProfile, "AppData", "Roaming", "Cursor")
}

// IsValidInstallDir verifies if a path looks like a valid Cursor root.
func (d *Detector) IsValidInstallDir(dir string) bool {
	if dir == "" {
		return false
	}
	exe := filepath.Join(dir, "Cursor.exe")
	workbench := filepath.Join(dir, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html")
	if _, err := os.Stat(exe); err != nil {
		return false
	}
	if _, err := os.Stat(workbench); err != nil {
		return false
	}
	return true
}

// ResolveExtensionsDir returns Cursor's extensions directory.
func (d *Detector) ResolveExtensionsDir(installDir string) string {
	for _, key := range []string{"CURSOR_EXTENSIONS_DIR", "VSCODE_EXTENSIONS"} {
		if env := os.Getenv(key); env != "" {
			return filepath.Clean(env)
		}
	}
	if portable := portableDataDir(installDir); portable != "" {
		return filepath.Join(portable, "extensions")
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = os.Getenv("USERPROFILE")
	}
	return filepath.Join(home, ".cursor", "extensions")
}

// HasLanguagePack reports whether the zh-cn locale is selected and the official
// language pack is actually present (registered in languagepacks.json or installed).
func (d *Detector) HasLanguagePack(installDir, userDataDir string) bool {
	if !strings.EqualFold(readConfiguredLocale(installDir), "zh-cn") {
		return false
	}
	if lpData, err := os.ReadFile(filepath.Join(userDataDir, "languagepacks.json")); err == nil {
		var lp map[string]struct {
			Extensions []struct {
				ExtensionIdentifier struct {
					ID string `json:"id"`
				} `json:"extensionIdentifier"`
			} `json:"extensions"`
		}
		if json.Unmarshal(lpData, &lp) == nil {
			for _, ext := range lp["zh-cn"].Extensions {
				if strings.EqualFold(ext.ExtensionIdentifier.ID, LanguagePackExtensionID) {
					return true
				}
			}
		}
	}
	return d.languagePackInstalled(installDir)
}

func (d *Detector) languagePackInstalled(installDir string) bool {
	extDir := d.ResolveExtensionsDir(installDir)
	entries, err := os.ReadDir(extDir)
	if err != nil {
		return false
	}
	prefix := LanguagePackExtensionID + "-"
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(strings.ToLower(e.Name()), prefix) {
			continue
		}
		if _, err := os.Stat(filepath.Join(extDir, e.Name(), "package.json")); err == nil {
			return true
		}
	}
	return false
}

// IsCursorRunning checks if Cursor.exe process is currently active.
func (d *Detector) IsCursorRunning() bool {
	return cursorRunningCheck()
}

func defaultIsCursorRunning() bool {
	cmd := exec.Command("tasklist", "/FI", "IMAGENAME eq Cursor.exe", "/FO", "CSV", "/NH")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return bytes.Contains(bytes.ToLower(out), []byte("cursor.exe"))
}

// Inspect checks current Cursor directory and returns detailed status.
func (d *Detector) Inspect(installDir, userDataDir string) (*CursorStatus, error) {
	resolvedInstall := d.ResolveInstallDir(installDir)
	if installDir != "" && !d.IsValidInstallDir(installDir) {
		// An explicitly chosen path must not be silently replaced by an auto-detected one.
		resolvedInstall = filepath.Clean(installDir)
	}
	resolvedUser := d.ResolveUserDataDir(resolvedInstall, userDataDir)

	status := &CursorStatus{
		InstallDir:  resolvedInstall,
		UserDataDir: resolvedUser,
	}

	if resolvedInstall == "" || !d.IsValidInstallDir(resolvedInstall) {
		status.State = StateNotFound
		status.Message = "未检测到有效的 Cursor 安装目录，请点击「选择 Cursor」定位。"
		status.CanApply = false
		status.CanRestore = false
		return status, nil
	}

	status.ExecutablePath = filepath.Join(resolvedInstall, "Cursor.exe")
	status.WorkbenchHTMLPath = filepath.Join(resolvedInstall, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html")

	// Read Cursor and VSCode versions from package.json and product.json
	pkgPath := filepath.Join(resolvedInstall, "resources", "app", "package.json")
	if data, err := os.ReadFile(pkgPath); err == nil {
		var pkg struct {
			Version string `json:"version"`
		}
		if json.Unmarshal(data, &pkg) == nil {
			status.CursorVersion = pkg.Version
		}
	}

	prodPath := filepath.Join(resolvedInstall, "resources", "app", "product.json")
	var productData struct {
		Checksums map[string]string `json:"checksums"`
	}
	if data, err := os.ReadFile(prodPath); err == nil {
		_ = json.Unmarshal(data, &productData)
	}

	// Check HTML injection
	htmlContent, err := os.ReadFile(status.WorkbenchHTMLPath)
	if err == nil {
		s := string(htmlContent)
		status.HasScriptInjection = strings.Contains(s, InjectionMarker) ||
			strings.Contains(s, LocalizationJSFile)
	}

	// Check main.js tray patch
	mainJsPath := filepath.Join(resolvedInstall, "resources", "app", "out", "main.js")
	if mainData, err := os.ReadFile(mainJsPath); err == nil {
		status.HasTrayPatch = bytes.Contains(mainData, []byte("最近智能体")) || bytes.Contains(mainData, []byte("清除所有通知"))
	}

	// Check if cursor-zh-runtime.js exists
	locJsPath := filepath.Join(resolvedInstall, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", LocalizationJSFile)
	locJsExists := false
	if data, err := os.ReadFile(locJsPath); err == nil {
		locJsExists = true
		if hash, body, ok := ParseBuildMarker(string(data)); ok && ContentHash(body) == hash {
			status.HasValidScript = true
			status.LocalizationBuild = hash
		}
	}

	// Check checksums
	appDir := filepath.Join(resolvedInstall, "resources", "app")
	validChecksums, mismatched := VerifyChecksums(appDir, productData.Checksums)
	status.ChecksumsValid = validChecksums
	status.MismatchedChecksums = mismatched

	// Check language pack
	status.HasLanguagePack = d.HasLanguagePack(resolvedInstall, resolvedUser)

	// Check if running
	status.IsRunning = d.IsCursorRunning()

	// Compute overall state
	if status.IsRunning {
		status.State = StateRunning
		status.Message = "Cursor 正在运行中。请在退出 Cursor 后应用或撤销汉化。"
		status.CanApply = false
		status.CanRestore = status.HasScriptInjection || locJsExists || status.HasTrayPatch
		return status, nil
	}

	if !status.HasScriptInjection && !locJsExists {
		status.State = StateUnpatched
		status.Message = "当前 Cursor 为原版未汉化状态，可一键应用中文本地化。"
		status.CanApply = true
		status.CanRestore = status.HasTrayPatch
		return status, nil
	}

	if !status.ChecksumsValid {
		status.State = StateCorruptedChecksum
		status.Message = fmt.Sprintf("检测到 %d 项核心文件校验不一致，需要修复校验以避免损坏弹窗。", len(status.MismatchedChecksums))
		status.CanApply = true
		status.CanRestore = true
		return status, nil
	}

	switch {
	case !status.HasScriptInjection || !locJsExists:
		status.Message = "检测到残留或不完整的汉化组件，建议重新应用以更新至完整状态。"
	case !status.HasValidScript:
		status.Message = "汉化脚本缺少构建标记或内容已损坏，建议重新应用。"
	case d.ExpectedBuildHash != "" && status.LocalizationBuild != d.ExpectedBuildHash:
		status.Message = "已安装的汉化与当前助手内置词典版本不一致，建议更新汉化。"
	case !status.HasLanguagePack:
		status.Message = "未检测到已生效的官方简体中文语言包，建议重新应用。"
	default:
		status.State = StatePatchedCurrent
		status.Message = "已成功应用中文汉化，所有核心校验与脚本均正常。"
		status.CanApply = true // allow re-apply / update
		status.CanRestore = true
		return status, nil
	}

	status.State = StatePatchedOutdated
	status.CanApply = true
	status.CanRestore = true
	return status, nil
}

// CalculateFileHash returns SHA256 base64 hash without trailing '=' (matching VS Code format).
func CalculateFileHash(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(hash.Sum(nil)), nil
}

// resolveChecksumTarget maps a product.json checksum key to a file under appDir.
func resolveChecksumTarget(appDir, key string) (string, error) {
	normKey := filepath.FromSlash(strings.TrimPrefix(key, "/"))
	for _, candidate := range []string{filepath.Join(appDir, "out", normKey), filepath.Join(appDir, normKey)} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}
	}
	return "", os.ErrNotExist
}

// VerifyChecksums checks target files against product.json checksums map.
// Missing or unreadable targets count as mismatches, and an empty map is invalid.
func VerifyChecksums(appDir string, checksums map[string]string) (bool, []string) {
	if len(checksums) == 0 {
		return false, []string{"product.json: checksums 缺失"}
	}
	var mismatched []string
	for key, expectedHash := range checksums {
		target, err := resolveChecksumTarget(appDir, key)
		if err != nil {
			mismatched = append(mismatched, key)
			continue
		}
		actualHash, err := CalculateFileHash(target)
		if err != nil || actualHash != expectedHash {
			mismatched = append(mismatched, key)
		}
	}
	sort.Strings(mismatched)
	return len(mismatched) == 0, mismatched
}
