package core

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestLanguageSwitchAndRestore(t *testing.T) {
	installDir, userDir := setupMockCursor(t)
	stubEnvironment(t, userDir, nil)
	root := os.DirFS("../..")
	_, runtimePath, mainPath, _ := mockPaths(installDir)
	originalMain := readFile(t, mainPath)
	for _, locale := range []string{SimplifiedChinese, TraditionalChinese, SimplifiedChinese, TraditionalChinese} {
		resources := LocalizedResources(root, locale)
		cachePath := filepath.Join(userDir, "clp", "test-pack."+locale, "tcf.json")
		if err := os.MkdirAll(filepath.Dir(cachePath), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(cachePath, []byte(`{"old":"cached"}`), 0644); err != nil {
			t.Fatal(err)
		}
		if _, err := NewInstaller(resources).Apply(installDir, userDir, nil); err != nil {
			t.Fatalf("apply %s: %v", locale, err)
		}
		if got := readConfiguredLocale(installDir); got != locale {
			t.Fatalf("display locale = %s, want %s", got, locale)
		}
		if !strings.Contains(readFile(t, mainPath), languageText(locale, "最近智能体")) {
			t.Fatalf("tray language does not match %s", locale)
		}
		var cache map[string]string
		if err := json.Unmarshal([]byte(readFile(t, cachePath)), &cache); err != nil {
			t.Fatal(err)
		}
		bridgePath := cache["anysphere.cursor-retrieval"]
		if !strings.Contains(readFile(t, bridgePath), languageText(locale, "处理 Cursor 的索引与检索能力")) {
			t.Fatalf("private extension language does not match %s", locale)
		}
		detector := NewDetector()
		detector.Locale = locale
		detector.ExpectedBuildHash, _, _ = ParseBuildMarker(readFile(t, runtimePath))
		status, err := detector.Inspect(installDir, userDir)
		if err != nil || status.State != StatePatchedCurrent || status.Locale != locale {
			t.Fatalf("inspect %s: %+v, %v", locale, status, err)
		}
		other := NewDetector()
		if locale == SimplifiedChinese {
			other.Locale = TraditionalChinese
		}
		if other.HasLanguagePack(installDir, userDir) {
			t.Fatal("other locale was reported as active")
		}
	}
	if _, err := NewRestorer(root).Restore(installDir, userDir, nil); err != nil {
		t.Fatal(err)
	}
	if got := readFile(t, mainPath); got != originalMain {
		t.Fatalf("tray was not completely restored: %s", got)
	}
	if _, err := os.Stat(runtimePath); !os.IsNotExist(err) {
		t.Fatalf("runtime still present after restoration: %v", err)
	}
}

func TestLanguageSwitchRollsBackOnFailure(t *testing.T) {
	installDir, userDir := setupMockCursor(t)
	stubEnvironment(t, userDir, nil)
	root := os.DirFS("../..")
	if _, err := NewInstaller(root).Apply(installDir, userDir, nil); err != nil {
		t.Fatal(err)
	}
	html, runtimePath, mainPath, product := mockPaths(installDir)
	argv, _ := cursorArgvPath(installDir)
	before := make(map[string]string)
	for _, name := range []string{html, runtimePath, mainPath, product, argv, filepath.Join(userDir, "languagepacks.json")} {
		before[name] = readFile(t, name)
	}
	runCursorCLI = func(string, ...string) ([]byte, error) { return nil, errors.New("installation failed") }
	if _, err := NewInstaller(LocalizedResources(root, TraditionalChinese)).Apply(installDir, userDir, nil); err == nil {
		t.Fatal("expected language pack failure")
	}
	for name, content := range before {
		if got := readFile(t, name); got != content {
			t.Fatalf("switch failure changed %s", name)
		}
	}
}

func TestTraditionalRuntimeAndLanguagePack(t *testing.T) {
	root := os.DirFS("../..")
	source, err := NewBuilder(LocalizedResources(root, TraditionalChinese)).BuildJavaScript()
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{`localizationLocale = "zh-tw"`, "檔案", "設定"} {
		if !strings.Contains(source, required) {
			t.Fatalf("traditional runtime missing %q", required)
		}
	}
	for _, simplified := range []string{"文件和文件夹", "暂无可用选项", "谨慎使用。"} {
		if strings.Contains(source, simplified) {
			t.Fatalf("hardcoded simplified translation remains: %s", simplified)
		}
	}
	filename := filepath.Join(t.TempDir(), "traditional-runtime.js")
	if err := os.WriteFile(filename, []byte(source), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("node", "../../localization/tools/test_runtime.cjs", filename, TraditionalChinese)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("traditional runtime: %v\n%s", err, output)
	}
	archive, err := zip.OpenReader("../../VSCode-language-pack-zh-hant.vsix")
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	for _, file := range archive.File {
		if file.Name != "extension/package.json" {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(data), `"zh-tw"`) || !strings.Contains(string(data), `"vscode-language-pack-zh-hant"`) {
			t.Fatal("incorrect bundled traditional language pack")
		}
		return
	}
	t.Fatal("language pack manifest missing")
}
