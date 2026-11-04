package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLocaleConfigPreservesJSONC(t *testing.T) {
	for _, input := range []string{
		"{\n // keep this\n \"locale\": \"en\", \"disable-hardware-acceleration\": true,\n}\n",
		"{/* locale is unset */\"nested\":{\"locale\":\"en\"},\"url\":\"https://example.com/*x*/\",}",
		"{ // empty configuration\n}",
	} {
		t.Run(input, func(t *testing.T) {
			installDir, userDir := setupMockCursor(t)
			stubEnvironment(t, userDir, nil)
			path, err := cursorArgvPath(installDir)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(input), 0644); err != nil {
				t.Fatal(err)
			}
			installer := NewInstaller(nil)
			if err := installer.setupLocale(installDir); err != nil {
				t.Fatal(err)
			}
			if locale := readConfiguredLocale(installDir); locale != "zh-cn" {
				t.Fatalf("effective locale = %q", locale)
			}
			output := readFile(t, path)
			for _, preserved := range []string{"// keep this", "/* locale is unset */", `"nested":{"locale":"en"}`, `"url":"https://example.com/*x*/"`, `"disable-hardware-acceleration": true`, "// empty configuration"} {
				if strings.Contains(input, preserved) && !strings.Contains(output, preserved) {
					t.Errorf("lost unrelated configuration: %s", preserved)
				}
			}
			if err := installer.setupLocale(installDir); err != nil {
				t.Fatal(err)
			}
			if readFile(t, path) != output {
				t.Error("reapplying locale changed the configuration again")
			}
		})
	}
}

func TestLocaleRejectsInvalidConfigWithoutChangingIt(t *testing.T) {
	installDir, userDir := setupMockCursor(t)
	stubEnvironment(t, userDir, nil)
	path, _ := cursorArgvPath(installDir)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	for _, input := range []string{`{"locale":`, `null`, `{/* unfinished`, `[]`} {
		if err := os.WriteFile(path, []byte(input), 0644); err != nil {
			t.Fatal(err)
		}
		if err := NewInstaller(nil).setupLocale(installDir); err == nil {
			t.Errorf("accepted invalid configuration %q", input)
		}
		if readFile(t, path) != input {
			t.Error("invalid configuration was overwritten")
		}
	}
}

func TestLocalePortablePaths(t *testing.T) {
	installDir, userDir := setupMockCursor(t)
	stubEnvironment(t, userDir, nil)
	portable := filepath.Join(installDir, "data")
	if err := os.Mkdir(portable, 0755); err != nil {
		t.Fatal(err)
	}
	path, _ := cursorArgvPath(installDir)
	if path != filepath.Join(portable, "argv.json") {
		t.Fatalf("wrong portable path: %s", path)
	}
	if err := NewInstaller(nil).setupLocale(installDir); err != nil {
		t.Fatal(err)
	}
	if readConfiguredLocale(installDir) != "zh-cn" {
		t.Error("portable locale not detected")
	}
	custom := t.TempDir()
	t.Setenv("VSCODE_PORTABLE", custom)
	path, _ = cursorArgvPath(installDir)
	if path != filepath.Join(custom, "argv.json") {
		t.Errorf("portable environment did not take precedence: %s", path)
	}
}

func TestInspectUsesEffectiveLocale(t *testing.T) {
	installDir, userDir := setupMockCursor(t)
	stubEnvironment(t, userDir, nil)
	if _, err := NewInstaller(os.DirFS("../..")).Apply(installDir, userDir, nil); err != nil {
		t.Fatal(err)
	}
	argvPath, _ := cursorArgvPath(installDir)
	if err := os.WriteFile(argvPath, []byte(`{"locale":"en"}`), 0644); err != nil {
		t.Fatal(err)
	}
	status, err := NewDetector().Inspect(installDir, userDir)
	if err != nil {
		t.Fatal(err)
	}
	if status.HasLanguagePack || status.State != StatePatchedOutdated {
		t.Fatalf("English configuration reported as localized: %+v", status)
	}
}
