package main

import (
	"os"
	"path/filepath"
	"testing"

	"cursor-zh/internal/core"
)

func TestSetCursorDirRefreshesPortableUserData(t *testing.T) {
	t.Setenv("CURSOR_USER_DATA_DIR", "")
	t.Setenv("VSCODE_PORTABLE", "")
	installDir := t.TempDir()
	workbenchDir := filepath.Join(installDir, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench")
	for _, dir := range []string{workbenchDir, filepath.Join(installDir, "data")} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{filepath.Join(installDir, "Cursor.exe"), filepath.Join(workbenchDir, "workbench.html")} {
		if err := os.WriteFile(path, nil, 0644); err != nil {
			t.Fatal(err)
		}
	}
	app := &App{detector: core.NewDetector(), userDataDir: "previous-selection"}
	status, err := app.SetCursorDir(installDir)
	if err != nil {
		t.Fatal(err)
	}
	wantUser := filepath.Join(installDir, "data", "user-data")
	if status.UserDataDir != wantUser || app.userDataDir != wantUser {
		t.Fatalf("displayed/action paths differ: status=%s action=%s", status.UserDataDir, app.userDataDir)
	}
}
