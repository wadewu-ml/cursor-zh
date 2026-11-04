package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestCalculateFileHashMatchesCursorFormat(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file.js")
	for _, data := range [][]byte{nil, []byte("中文 runtime"), bytes.Repeat([]byte("large file\n"), 10000)} {
		if err := os.WriteFile(path, data, 0644); err != nil {
			t.Fatal(err)
		}
		want := sha256.Sum256(data)
		got, err := CalculateFileHash(path)
		if err != nil || got != base64.RawStdEncoding.EncodeToString(want[:]) {
			t.Fatalf("hash = %q, err = %v", got, err)
		}
	}
}

func TestDirectoryResolution(t *testing.T) {
	for _, scenario := range []string{"normal", "portable-directory", "portable-environment", "custom-environment", "standard-extensions-environment"} {
		t.Run(scenario, func(t *testing.T) {
			installDir, userDir := setupMockCursor(t)
			stubEnvironment(t, userDir, nil)
			t.Setenv("CURSOR_USER_DATA_DIR", "")
			t.Setenv("CURSOR_EXTENSIONS_DIR", "")
			appData := t.TempDir()
			t.Setenv("APPDATA", appData)
			home, err := os.UserHomeDir()
			if err != nil {
				t.Fatal(err)
			}
			wantUser := filepath.Join(appData, "Cursor")
			wantExtensions := filepath.Join(home, ".cursor", "extensions")
			wantArgv := filepath.Join(home, ".cursor", "argv.json")
			if scenario != "normal" && scenario != "standard-extensions-environment" {
				portable := filepath.Join(installDir, "data")
				if err := os.Mkdir(portable, 0755); err != nil {
					t.Fatal(err)
				}
				if scenario == "portable-environment" {
					portable = t.TempDir()
					t.Setenv("VSCODE_PORTABLE", portable)
				}
				wantUser = filepath.Join(portable, "user-data")
				wantExtensions = filepath.Join(portable, "extensions")
				wantArgv = filepath.Join(portable, "argv.json")
			}
			if scenario == "custom-environment" {
				wantUser = filepath.Join(t.TempDir(), "custom user data")
				wantExtensions = filepath.Join(t.TempDir(), "custom extensions")
				t.Setenv("CURSOR_USER_DATA_DIR", wantUser)
				t.Setenv("VSCODE_EXTENSIONS", "unused-standard-directory")
				t.Setenv("CURSOR_EXTENSIONS_DIR", wantExtensions)
			}
			if scenario == "standard-extensions-environment" {
				wantExtensions = filepath.Join(t.TempDir(), "standard extensions")
				t.Setenv("VSCODE_EXTENSIONS", wantExtensions)
			}
			detector := NewDetector()
			if got := detector.ResolveUserDataDir(installDir, ""); got != wantUser {
				t.Errorf("user data = %s, want %s", got, wantUser)
			}
			if got := detector.ResolveExtensionsDir(installDir); got != wantExtensions {
				t.Errorf("extensions = %s, want %s", got, wantExtensions)
			}
			if got, err := cursorArgvPath(installDir); err != nil || got != wantArgv {
				t.Errorf("argv = %s, %v, want %s", got, err, wantArgv)
			}
		})
	}
}

func BenchmarkCalculateFileHash(b *testing.B) {
	path := filepath.Join(b.TempDir(), "main.js")
	data := bytes.Repeat([]byte("runtime;"), 1<<20)
	if err := os.WriteFile(path, data, 0644); err != nil {
		b.Fatal(err)
	}
	for _, name := range []string{"read_all", "stream"} {
		b.Run(name, func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(data)))
			for b.Loop() {
				if name == "stream" {
					if _, err := CalculateFileHash(path); err != nil {
						b.Fatal(err)
					}
				} else {
					content, err := os.ReadFile(path)
					if err != nil {
						b.Fatal(err)
					}
					sum := sha256.Sum256(content)
					_ = base64.RawStdEncoding.EncodeToString(sum[:])
				}
			}
		})
	}
}
