package core

import "testing"

func TestRemoveInjectionPreservesUnrelatedContent(t *testing.T) {
	base := `<html><body>Current workbench</body><script src="./other.js"></script></html>`
	for _, injection := range []string{
		InjectionMarker + `<script src="./cursor-zh-runtime.js"></script>`,
		`<script defer src='./cursor-zh-runtime.js'></script>`,
		InjectionMarker,
	} {
		content := base + injection
		if !hasInjection(content) {
			t.Fatalf("injection not detected: %s", injection)
		}
		if got := removeInjection(content); got != base {
			t.Errorf("unrelated workbench content changed: %s", got)
		}
	}
}
