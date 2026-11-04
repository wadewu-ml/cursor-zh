package core

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// stubEnvironment isolates tests from the real Cursor process list and CLI.
// When cliErr is nil the fake CLI "installs" the language pack into a temp extensions dir
// and registers it in languagepacks.json, as Cursor does.
func stubEnvironment(t *testing.T, userDataDir string, cliErr error) {
	t.Helper()
	extDir := filepath.Join(t.TempDir(), "extensions")
	t.Setenv("CURSOR_EXTENSIONS_DIR", extDir)
	t.Setenv("VSCODE_EXTENSIONS", "")
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	t.Setenv("HOME", home)
	t.Setenv("VSCODE_PORTABLE", "")

	oldRunning, oldCLI := cursorRunningCheck, runCursorCLI
	t.Cleanup(func() { cursorRunningCheck, runCursorCLI = oldRunning, oldCLI })
	cursorRunningCheck = func() bool { return false }
	runCursorCLI = func(installDir string, args ...string) ([]byte, error) {
		extDir := NewDetector().ResolveExtensionsDir(installDir)
		if !slices.Contains(args, "--extensions-dir="+extDir) ||
			!slices.Contains(args, "--user-data-dir="+userDataDir) {
			return nil, errors.New("CLI directory arguments do not match the detector")
		}
		if cliErr != nil {
			return []byte("boom"), cliErr
		}
		profile := languageFor(readConfiguredLocale(installDir))
		packDir := filepath.Join(extDir, profile.extensionID+"-1.0.0")
		if err := os.MkdirAll(filepath.Join(packDir, "translations"), 0755); err != nil {
			return nil, err
		}
		if err := os.WriteFile(filepath.Join(packDir, "package.json"), []byte(`{}`), 0644); err != nil {
			return nil, err
		}
		lp := make(map[string]any)
		if previous, err := os.ReadFile(filepath.Join(userDataDir, "languagepacks.json")); err == nil {
			if err := json.Unmarshal(previous, &lp); err != nil {
				return nil, err
			}
		}
		lp[profile.locale] = map[string]any{
			"hash":         "test-pack",
			"extensions":   []any{map[string]any{"extensionIdentifier": map[string]any{"id": profile.extensionID}}},
			"translations": map[string]any{"vscode": filepath.Join(userDataDir, "clp", profile.locale, "main.i18n.json")},
		}
		data, _ := json.Marshal(lp)
		if err := os.MkdirAll(userDataDir, 0755); err != nil {
			return nil, err
		}
		return nil, os.WriteFile(filepath.Join(userDataDir, "languagepacks.json"), data, 0644)
	}
}

func mockPaths(installDir string) (html, js, mainJs, prod string) {
	appDir := filepath.Join(installDir, "resources", "app")
	wb := filepath.Join(appDir, "out", "vs", "code", "electron-sandbox", "workbench")
	return filepath.Join(wb, "workbench.html"), filepath.Join(wb, LocalizationJSFile),
		filepath.Join(appDir, "out", "main.js"), filepath.Join(appDir, "product.json")
}

func readFile(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func setupMockCursor(t *testing.T) (string, string) {
	t.Helper()
	tmpDir := t.TempDir()
	installDir := filepath.Join(tmpDir, "cursor")
	userDataDir := filepath.Join(tmpDir, "userdata")

	appDir := filepath.Join(installDir, "resources", "app")
	wbDir := filepath.Join(appDir, "out", "vs", "code", "electron-sandbox", "workbench")
	mainDir := filepath.Join(appDir, "out")
	if err := os.MkdirAll(wbDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(userDataDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Fake Cursor.exe
	if err := os.WriteFile(filepath.Join(installDir, "Cursor.exe"), []byte("MZ..."), 0755); err != nil {
		t.Fatal(err)
	}

	// Fake package.json
	pkgData := []byte(`{"name":"cursor","version":"3.24.12"}`)
	if err := os.WriteFile(filepath.Join(appDir, "package.json"), pkgData, 0644); err != nil {
		t.Fatal(err)
	}

	// Fake workbench.html
	htmlData := []byte(`<!DOCTYPE html><html><head><title>Cursor</title></head><body><h1>Workbench</h1></body></html>`)
	if err := os.WriteFile(filepath.Join(wbDir, "workbench.html"), htmlData, 0644); err != nil {
		t.Fatal(err)
	}

	// Fake main.js with tray text
	mainJsData := []byte(`var tray = { label:"Recent Agents", tip:"No recent agents" };`)
	if err := os.WriteFile(filepath.Join(mainDir, "main.js"), mainJsData, 0644); err != nil {
		t.Fatal(err)
	}

	// Fake product.json with checksums
	htmlHash, _ := CalculateFileHash(filepath.Join(wbDir, "workbench.html"))
	mainHash, _ := CalculateFileHash(filepath.Join(mainDir, "main.js"))
	prod := map[string]any{
		"nameShort": "Cursor",
		"checksums": map[string]string{
			"vs/code/electron-sandbox/workbench/workbench.html": htmlHash,
			"main.js": mainHash,
		},
	}
	prodBytes, _ := json.MarshalIndent(prod, "", "\t")
	if err := os.WriteFile(filepath.Join(appDir, "product.json"), prodBytes, 0644); err != nil {
		t.Fatal(err)
	}

	return installDir, userDataDir
}

func TestApplyAndRestoreLifecycle(t *testing.T) {
	installDir, userDataDir := setupMockCursor(t)
	stubEnvironment(t, userDataDir, nil)
	rootFS := os.DirFS("../..")

	det := NewDetector()
	if js, err := NewBuilder(rootFS).BuildJavaScript(); err == nil {
		if hash, _, ok := ParseBuildMarker(js); ok {
			det.ExpectedBuildHash = hash
		}
	}
	if det.ExpectedBuildHash == "" {
		t.Fatal("could not compute expected build hash")
	}
	status, err := det.Inspect(installDir, userDataDir)
	if err != nil {
		t.Fatalf("Inspect failed: %v", err)
	}
	if status.State != StateUnpatched {
		t.Errorf("expected StateUnpatched, got %s", status.State)
	}

	// Test Apply
	installer := NewInstaller(rootFS)
	res, err := installer.Apply(installDir, userDataDir, nil)
	if err != nil {
		t.Fatalf("Apply failed: %v", err)
	}
	if !res.Success {
		t.Errorf("Apply returned false success")
	}

	// Verify files after Apply
	wbHtml := filepath.Join(installDir, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html")
	htmlBytes, _ := os.ReadFile(wbHtml)
	if !strings.Contains(string(htmlBytes), InjectionMarker) {
		t.Errorf("workbench.html does not contain injection marker")
	}
	if !strings.Contains(string(htmlBytes), LocalizationJSFile) {
		t.Errorf("workbench.html does not contain script tag")
	}

	targetJs := filepath.Join(installDir, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", LocalizationJSFile)
	if _, err := os.Stat(targetJs); err != nil {
		t.Errorf("cursor-zh-runtime.js was not created: %v", err)
	}

	mainJs := filepath.Join(installDir, "resources", "app", "out", "main.js")
	mainBytes, _ := os.ReadFile(mainJs)
	if !strings.Contains(string(mainBytes), "最近智能体") {
		t.Errorf("main.js does not contain patched tray text")
	}

	// Verify Status after Apply
	statusAfter, err := det.Inspect(installDir, userDataDir)
	if err != nil {
		t.Fatalf("Inspect after apply failed: %v", err)
	}
	if statusAfter.State != StatePatchedCurrent {
		t.Errorf("expected StatePatchedCurrent, got %s (checksums valid: %v, mismatches: %v)",
			statusAfter.State, statusAfter.ChecksumsValid, statusAfter.MismatchedChecksums)
	}

	// Test Restore
	restorer := NewRestorer(rootFS)
	restoreRes, err := restorer.Restore(installDir, userDataDir, nil)
	if err != nil {
		t.Fatalf("Restore failed: %v", err)
	}
	if !restoreRes.Success {
		t.Errorf("Restore returned false success")
	}

	// Verify files after Restore
	htmlBytesRestored, _ := os.ReadFile(wbHtml)
	if strings.Contains(string(htmlBytesRestored), InjectionMarker) {
		t.Errorf("workbench.html still contains injection marker")
	}
	if strings.Contains(string(htmlBytesRestored), LocalizationJSFile) {
		t.Errorf("workbench.html still contains script tag")
	}
	if _, err := os.Stat(targetJs); !os.IsNotExist(err) {
		t.Errorf("cursor-zh-runtime.js was not deleted")
	}

	mainBytesRestored, _ := os.ReadFile(mainJs)
	if !strings.Contains(string(mainBytesRestored), "Recent Agents") {
		t.Errorf("main.js did not restore Recent Agents")
	}

	// Verify Status after Restore
	statusRestored, err := det.Inspect(installDir, userDataDir)
	if err != nil {
		t.Fatalf("Inspect after restore failed: %v", err)
	}
	if statusRestored.State != StateUnpatched {
		t.Errorf("expected StateUnpatched after restore, got %s", statusRestored.State)
	}
}

func TestApplyRollsBackWhenLanguagePackFails(t *testing.T) {
	installDir, userDataDir := setupMockCursor(t)
	stubEnvironment(t, userDataDir, errors.New("cli failed"))
	html, js, mainJs, prod := mockPaths(installDir)
	before := map[string]string{html: readFile(t, html), mainJs: readFile(t, mainJs), prod: readFile(t, prod)}

	if _, err := NewInstaller(os.DirFS("../..")).Apply(installDir, userDataDir, nil); err == nil {
		t.Fatal("expected Apply to fail when the language pack cannot be installed")
	}
	for p, want := range before {
		if got := readFile(t, p); got != want {
			t.Errorf("%s was not rolled back", filepath.Base(p))
		}
	}
	if _, err := os.Stat(js); !os.IsNotExist(err) {
		t.Error("localization script should not exist after failed apply")
	}
	argvPath, err := cursorArgvPath(installDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(argvPath); !os.IsNotExist(err) {
		t.Error("argv.json should be removed by rollback")
	}
}

func TestApplyRollsBackWhenChecksumWriteFails(t *testing.T) {
	installDir, userDataDir := setupMockCursor(t)
	stubEnvironment(t, userDataDir, nil)
	html, js, mainJs, prod := mockPaths(installDir)
	htmlBefore, mainBefore := readFile(t, html), readFile(t, mainJs)

	if err := os.Chmod(prod, 0444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(prod, 0644) })

	if _, err := NewInstaller(os.DirFS("../..")).Apply(installDir, userDataDir, nil); err == nil {
		t.Skip("filesystem allowed replacing a read-only file; cannot simulate write failure")
	}
	if readFile(t, html) != htmlBefore {
		t.Error("workbench.html was not rolled back")
	}
	if readFile(t, mainJs) != mainBefore {
		t.Error("main.js was not rolled back")
	}
	if _, err := os.Stat(js); !os.IsNotExist(err) {
		t.Error("localization script should be removed by rollback")
	}
}

func TestRestoreKeepsScriptWhenHTMLCannotBeCleaned(t *testing.T) {
	installDir, userDataDir := setupMockCursor(t)
	stubEnvironment(t, userDataDir, nil)
	rootFS := os.DirFS("../..")
	if _, err := NewInstaller(rootFS).Apply(installDir, userDataDir, nil); err != nil {
		t.Fatalf("Apply failed: %v", err)
	}
	html, js, _, _ := mockPaths(installDir)
	if err := os.Chmod(html, 0444); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(html, 0644) })

	if _, err := NewRestorer(rootFS).Restore(installDir, userDataDir, nil); err == nil {
		t.Skip("filesystem allowed replacing a read-only file; cannot simulate write failure")
	}
	if _, err := os.Stat(js); err != nil {
		t.Error("script must remain while workbench.html still references it")
	}
	if !hasInjection(readFile(t, html)) {
		t.Error("workbench.html injection unexpectedly removed")
	}
}

func TestInspectReportsInvalidAndOutdatedScripts(t *testing.T) {
	installDir, userDataDir := setupMockCursor(t)
	stubEnvironment(t, userDataDir, nil)
	if _, err := NewInstaller(os.DirFS("../..")).Apply(installDir, userDataDir, nil); err != nil {
		t.Fatalf("Apply failed: %v", err)
	}
	_, js, _, _ := mockPaths(installDir)

	det := NewDetector()
	det.ExpectedBuildHash = "some-other-build"
	st, _ := det.Inspect(installDir, userDataDir)
	if st.State != StatePatchedOutdated || !st.HasValidScript {
		t.Errorf("expected outdated with valid script, got %s valid=%v", st.State, st.HasValidScript)
	}

	// Tampered body: marker no longer matches. Keep checksums aside by checking the flag.
	if err := os.WriteFile(js, []byte(readFile(t, js)+"\n// tampered"), 0644); err != nil {
		t.Fatal(err)
	}
	st, _ = NewDetector().Inspect(installDir, userDataDir)
	if st.HasValidScript || st.State == StatePatchedCurrent {
		t.Errorf("tampered script must not be reported valid/current, got %s", st.State)
	}
}

func TestInspectKeepsExplicitInvalidPath(t *testing.T) {
	bad := filepath.Join(t.TempDir(), "not-cursor")
	st, err := NewDetector().Inspect(bad, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if st.State != StateNotFound || st.InstallDir != filepath.Clean(bad) {
		t.Errorf("explicit invalid path replaced: state=%s dir=%s", st.State, st.InstallDir)
	}
}

func TestVerifyChecksumsEdgeCases(t *testing.T) {
	dir := t.TempDir()
	if ok, _ := VerifyChecksums(dir, nil); ok {
		t.Error("empty checksum map must be invalid")
	}
	ok, mism := VerifyChecksums(dir, map[string]string{"missing.js": "abc"})
	if ok || len(mism) != 1 {
		t.Errorf("missing target must be a mismatch, got ok=%v mism=%v", ok, mism)
	}
}

func TestApplyUsesPortableDirectories(t *testing.T) {
	installDir, _ := setupMockCursor(t)
	portable := filepath.Join(installDir, "data")
	if err := os.Mkdir(portable, 0755); err != nil {
		t.Fatal(err)
	}
	userDir := filepath.Join(portable, "user-data")
	stubEnvironment(t, userDir, nil)
	t.Setenv("CURSOR_EXTENSIONS_DIR", "")
	if _, err := NewInstaller(os.DirFS("../..")).Apply(installDir, userDir, nil); err != nil {
		t.Fatal(err)
	}
	status, err := NewDetector().Inspect(installDir, "")
	if err != nil {
		t.Fatal(err)
	}
	if status.State != StatePatchedCurrent || status.UserDataDir != userDir {
		t.Fatalf("portable status is inconsistent: %+v", status)
	}
	if !NewDetector().languagePackInstalled(installDir) {
		t.Error("language pack not installed in the portable extensions directory")
	}
}

func TestApplyRefreshesTranslationCacheAndRollsBack(t *testing.T) {
	for _, fail := range []bool{false, true} {
		name := "success"
		if fail {
			name = "rollback"
		}
		t.Run(name, func(t *testing.T) {
			installDir, userDir := setupMockCursor(t)
			stubEnvironment(t, userDir, nil)
			cacheDir := filepath.Join(userDir, "clp", "test-pack.zh-cn")
			if err := os.MkdirAll(filepath.Join(cacheDir, "commit"), 0755); err != nil {
				t.Fatal(err)
			}
			cachePath := filepath.Join(cacheDir, "tcf.json")
			original := `{"vscode":"existing translation"}`
			if err := os.WriteFile(cachePath, []byte(original), 0644); err != nil {
				t.Fatal(err)
			}
			argvPath, _ := cursorArgvPath(installDir)
			if err := os.MkdirAll(filepath.Dir(argvPath), 0755); err != nil {
				t.Fatal(err)
			}
			argv := "{ // preserve on failure\n\"locale\":\"en\",\"disable-hardware-acceleration\":true}"
			if err := os.WriteFile(argvPath, []byte(argv), 0644); err != nil {
				t.Fatal(err)
			}
			_, _, _, prod := mockPaths(installDir)
			if fail {
				if err := os.WriteFile(prod, []byte(`{"checksums":{"missing.js":"hash"}}`), 0644); err != nil {
					t.Fatal(err)
				}
			}
			_, err := NewInstaller(os.DirFS("../..")).Apply(installDir, userDir, nil)
			if fail {
				if err == nil {
					t.Fatal("expected checksum failure")
				}
				if readFile(t, cachePath) != original || readFile(t, argvPath) != argv {
					t.Error("cache or argv.json was not restored exactly")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var translations map[string]string
			if err := json.Unmarshal([]byte(readFile(t, cachePath)), &translations); err != nil {
				t.Fatal(err)
			}
			for id := range PrivateExtensions {
				if _, err := os.Stat(translations[id]); err != nil {
					t.Errorf("cached bridge %s is unavailable: %v", id, err)
				}
			}
			if _, err := os.Stat(filepath.Join(cacheDir, "commit")); err != nil {
				t.Error("compiled messages cache was removed")
			}
		})
	}
}
