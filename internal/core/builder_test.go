package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildJavaScript(t *testing.T) {
	// Use real filesystem root (relative to internal/core is ../..)
	rootFS := os.DirFS("../..")
	builder := NewBuilder(rootFS)

	js, err := builder.BuildJavaScript()
	if err != nil {
		t.Fatalf("BuildJavaScript failed: %v", err)
	}

	for _, fragment := range []string{
		"var translationDictionary = new Map(",
		"var translationPatterns = [",
		"var PARTIAL_FRAGMENTS = [",
		"var DROPDOWN_FRAGMENTS = [",
		"var DOCUMENT_KEYWORD_GROUPS",
		"function getMarketplaceDictionaryPayload()",
		"function ensureMarketplaceDictionary()",
		"marketplacePluginNames = p.pluginNames",
		"function translateSubtreeRegions()",
		"var SETTINGS_MCP_FRAGMENTS = [",
		"var SETTINGS_DOMAIN_FRAGMENTS = [",
		"Reset to default",
	} {
		if !strings.Contains(js, fragment) {
			t.Errorf("missing runtime fragment: %s", fragment)
		}
	}

	// Write to temporary file and run node --check
	tmpDir := t.TempDir()
	testJS := filepath.Join(tmpDir, "test_generated.js")
	if err := os.WriteFile(testJS, []byte(js), 0644); err != nil {
		t.Fatalf("write test js failed: %v", err)
	}

	cmd := exec.Command("node", "--check", testJS)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("node --check failed: %v\nOutput: %s", err, string(out))
	}
}

func TestBuildMarketplacePatternsAndMarker(t *testing.T) {
	js, err := NewBuilder(os.DirFS("../..")).BuildJavaScript()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(js, "new RegExp(") || !strings.Contains(js, "最后更新 $1") {
		t.Error("marketplace patterns missing from build output")
	}
	hash, body, ok := ParseBuildMarker(js)
	if !ok || ContentHash(body) != hash {
		t.Error("build marker missing or inconsistent")
	}
	js2, _ := NewBuilder(os.DirFS("../..")).BuildJavaScript()
	if js2 != js {
		t.Error("build output is not deterministic")
	}
}

func TestRuntimeRegressions(t *testing.T) {
	for _, script := range []string{"test_editable.cjs", "test_market.cjs"} {
		t.Run(script, func(t *testing.T) {
			cmd := exec.Command("node", filepath.Join("../..", "localization", "tools", script))
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("runtime regression: %v\n%s", err, out)
			}
		})
	}
}

func TestCompleteRuntimeStartup(t *testing.T) {
	script, err := NewBuilder(os.DirFS("../..")).BuildJavaScript()
	if err != nil {
		t.Fatal(err)
	}
	runtimePath := filepath.Join(t.TempDir(), "runtime.js")
	if err := os.WriteFile(runtimePath, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("node", filepath.Join("../..", "localization", "tools", "test_runtime.cjs"), runtimePath)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("complete runtime regression: %v\n%s", err, out)
	}
}
