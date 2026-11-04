package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"cursor-zh/internal/core"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct binds Go backend to Wails frontend.
type App struct {
	ctx         context.Context
	fsys        fs.FS
	detector    *core.Detector
	installer   *core.Installer
	restorer    *core.Restorer
	updater     *core.Updater
	installDir  string
	userDataDir string
	mu          sync.Mutex
	logs        []string
	lastUpdate  *core.UpdateInfo
}

// NewApp creates a new App application struct.
func NewApp(fsys fs.FS) *App {
	det := core.NewDetector()
	initialInstall := det.ResolveInstallDir("")
	initialUser := det.ResolveUserDataDir(initialInstall, "")
	locale := core.DetectLocale(initialInstall)
	resources := core.LocalizedResources(fsys, locale)
	det.Locale = locale
	// The detector compares the installed script against the build embedded in this binary.
	if js, err := core.NewBuilder(resources).BuildJavaScript(); err == nil {
		if hash, _, ok := core.ParseBuildMarker(js); ok {
			det.ExpectedBuildHash = hash
		}
	}
	inst := core.NewInstaller(resources)
	rest := core.NewRestorer(fsys)
	upd := core.NewUpdater("")

	return &App{
		fsys:        fsys,
		detector:    det,
		installer:   inst,
		restorer:    rest,
		updater:     upd,
		installDir:  initialInstall,
		userDataDir: initialUser,
	}
}

// startup is called when the app starts. The context can be saved
// so we can call the runtime methods.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if exe, err := os.Executable(); err == nil {
		core.CleanupOldBinary(exe)
	}
}

func (a *App) appendLog(msg string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.logs = append(a.logs, msg)
}

func (a *App) localize(text string) string {
	a.mu.Lock()
	locale := a.detector.Locale
	a.mu.Unlock()
	if locale == core.TraditionalChinese {
		return core.TraditionalText(text)
	}
	return text
}

// GetStatus returns current Cursor inspection status.
func (a *App) GetStatus() *core.CursorStatus {
	a.mu.Lock()
	dir := a.installDir
	user := a.userDataDir
	detector := a.detector
	a.mu.Unlock()

	if dir == "" {
		user = ""
	}
	status, err := detector.Inspect(dir, user)
	if err != nil {
		return &core.CursorStatus{
			State:   core.StateNotFound,
			Message: fmt.Sprintf("检查状态失败: %v", err),
		}
	}
	// Keep actions on exactly the directory the UI displays.
	if status.State != core.StateNotFound {
		a.mu.Lock()
		if a.installDir == dir {
			a.installDir = status.InstallDir
			a.userDataDir = status.UserDataDir
		}
		a.mu.Unlock()
	}
	return status
}

func (a *App) SetLanguage(locale string) (*core.CursorStatus, error) {
	if locale != core.SimplifiedChinese && locale != core.TraditionalChinese {
		return nil, errors.New("不支持的界面语言")
	}
	resources := core.LocalizedResources(a.fsys, locale)
	script, err := core.NewBuilder(resources).BuildJavaScript()
	if err != nil {
		return nil, err
	}
	hash, _, _ := core.ParseBuildMarker(script)
	detector := core.NewDetector()
	detector.Locale = locale
	detector.ExpectedBuildHash = hash
	a.mu.Lock()
	a.detector = detector
	a.installer = core.NewInstaller(resources)
	a.mu.Unlock()
	return a.GetStatus(), nil
}

// SelectCursorDir displays a native folder picker dialog.
func (a *App) SelectCursorDir() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context not initialized")
	}
	selected, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: a.localize("选择 Cursor 安装目录（包含 Cursor.exe）"),
	})
	if err != nil {
		return "", err
	}
	return selected, nil
}

// SetCursorDir validates and stores the installation directory, then returns refreshed status.
// An invalid directory is rejected and the current selection is kept.
func (a *App) SetCursorDir(path string) (*core.CursorStatus, error) {
	if !a.detector.IsValidInstallDir(path) {
		return nil, fmt.Errorf("所选目录不是有效的 Cursor 安装目录（需包含 Cursor.exe 与 resources\\app）: %s", path)
	}
	a.mu.Lock()
	a.installDir = filepath.Clean(path)
	a.userDataDir = a.detector.ResolveUserDataDir(a.installDir, "")
	a.mu.Unlock()
	return a.GetStatus(), nil
}

// ApplyLocalization executes the localization setup.
func (a *App) ApplyLocalization() *core.ActionResult {
	a.mu.Lock()
	dir := a.installDir
	user := a.userDataDir
	installer := a.installer
	a.mu.Unlock()

	progressCb := func(stage, detail string) {
		stage, detail = a.localize(stage), a.localize(detail)
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "progress", map[string]string{
				"stage":  stage,
				"detail": detail,
			})
		}
		a.appendLog(fmt.Sprintf("[%s] %s", stage, detail))
	}

	res, err := installer.Apply(dir, user, progressCb)
	if err != nil {
		a.appendLog(fmt.Sprintf("[错误] 应用汉化失败: %v", err))
		return &core.ActionResult{
			Success: false,
			Message: "应用汉化失败",
			Error:   err.Error(),
			Logs:    a.GetLogs(),
		}
	}
	res.Message = a.localize(res.Message)
	return res
}

// RestoreLocalization reverts the localization modifications.
func (a *App) RestoreLocalization() *core.ActionResult {
	a.mu.Lock()
	dir := a.installDir
	user := a.userDataDir
	a.mu.Unlock()

	progressCb := func(stage, detail string) {
		stage, detail = a.localize(stage), a.localize(detail)
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "progress", map[string]string{
				"stage":  stage,
				"detail": detail,
			})
		}
		a.appendLog(fmt.Sprintf("[%s] %s", stage, detail))
	}

	res, err := a.restorer.Restore(dir, user, progressCb)
	if err != nil {
		a.appendLog(fmt.Sprintf("[错误] 撤销汉化失败: %v", err))
		return &core.ActionResult{
			Success: false,
			Message: "撤销汉化失败",
			Error:   err.Error(),
			Logs:    a.GetLogs(),
		}
	}
	res.Message = a.localize(res.Message)
	return res
}

// LaunchCursor starts Cursor.exe in the background.
func (a *App) LaunchCursor() error {
	a.mu.Lock()
	dir := a.installDir
	user := a.userDataDir
	a.mu.Unlock()

	exePath := filepath.Join(dir, "Cursor.exe")
	cmd := exec.Command(exePath, fmt.Sprintf("--user-data-dir=%s", user),
		fmt.Sprintf("--extensions-dir=%s", a.detector.ResolveExtensionsDir(dir)))
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("启动 Cursor.exe 失败: %w", err)
	}
	return nil
}

// CheckAppUpdate queries GitHub for application updates.
func (a *App) CheckAppUpdate() *core.UpdateInfo {
	info, err := a.updater.CheckUpdate(core.AppVersion)
	if err != nil {
		return &core.UpdateInfo{
			Available:      false,
			Configured:     a.updater.Configured(),
			CurrentVersion: core.AppVersion,
			Error:          err.Error(),
		}
	}
	a.mu.Lock()
	a.lastUpdate = info
	a.mu.Unlock()
	return info
}

// ApplyAppUpdate downloads the latest release, verifies its SHA-256, swaps the
// executable in place and restarts the helper.
func (a *App) ApplyAppUpdate() *core.ActionResult {
	a.mu.Lock()
	info := a.lastUpdate
	a.mu.Unlock()
	fail := func(err error) *core.ActionResult {
		a.appendLog(fmt.Sprintf("[错误] 更新失败: %v", err))
		return &core.ActionResult{Success: false, Message: "更新失败", Error: err.Error(), Logs: a.GetLogs()}
	}
	if info == nil || !info.Available {
		return fail(errors.New("没有可用的更新，请先检查更新"))
	}
	exe, err := os.Executable()
	if err != nil {
		return fail(err)
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	a.appendLog(fmt.Sprintf("[更新] 下载 %s ...", info.AssetName))
	newPath, err := a.updater.DownloadUpdate(info, exe)
	if err != nil {
		return fail(err)
	}
	a.appendLog("[更新] SHA-256 校验通过，正在替换程序...")
	if err := core.InstallUpdate(newPath, exe); err != nil {
		_ = os.Remove(newPath)
		return fail(err)
	}
	cmd := exec.Command(exe)
	cmd.Dir = filepath.Dir(exe)
	if err := cmd.Start(); err != nil {
		return fail(fmt.Errorf("已更新到 %s，但自动重启失败，请手动重新打开: %w", info.LatestVersion, err))
	}
	if a.ctx != nil {
		go wailsRuntime.Quit(a.ctx)
	}
	return &core.ActionResult{Success: true, Message: "已更新到 " + info.LatestVersion + "，正在重启...", Logs: a.GetLogs()}
}

// GetAppVersion returns the running helper version.
func (a *App) GetAppVersion() string {
	return core.AppVersion
}

// GetLogs returns all runtime logs recorded so far.
func (a *App) GetLogs() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	res := make([]string, len(a.logs))
	copy(res, a.logs)
	return res
}
