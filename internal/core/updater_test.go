package core

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"v2.0.0", "v1.9.9", 1},
		{"v1.10.0", "v1.9.0", 1},
		{"1.0.0", "v1.0.0", 0},
		{"v1.0.0-beta", "v1.0.0", -1},
		{"v1.0.0-rc.1", "v1.0.0-beta", 1},
	}
	for _, c := range cases {
		got, err := CompareVersions(c.a, c.b)
		if err != nil || got != c.want {
			t.Errorf("CompareVersions(%s,%s)=%d,%v want %d", c.a, c.b, got, err, c.want)
		}
	}
	if _, err := CompareVersions("latest", "v1.0.0"); err == nil {
		t.Error("expected parse error")
	}
}

func newReleaseServer(t *testing.T, payload []byte, hashInBody string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	var srv *httptest.Server
	mux.HandleFunc("/repos/o/r/releases/latest", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, `{"tag_name":"v9.0.0","body":%q,"assets":[
			{"name":"cursor-zh.exe","browser_download_url":"%s/dl/app.exe"},
			{"name":"cursor-zh.exe.sha256","browser_download_url":"%s/dl/app.sha256"}]}`,
			hashInBody, srv.URL, srv.URL)
	})
	mux.HandleFunc("/dl/app.exe", func(w http.ResponseWriter, _ *http.Request) { w.Write(payload) })
	mux.HandleFunc("/dl/app.sha256", func(w http.ResponseWriter, _ *http.Request) {
		sum := sha256.Sum256(payload)
		fmt.Fprintf(w, "%s  cursor-zh.exe\n", hex.EncodeToString(sum[:]))
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestCheckDownloadInstallUpdate(t *testing.T) {
	payload := []byte("new binary")
	srv := newReleaseServer(t, payload, "release notes")
	u := NewUpdater("o/r")
	u.apiBase = srv.URL

	info, err := u.CheckUpdate("v1.0.0")
	if err != nil || !info.Available || info.AssetName != "cursor-zh.exe" || info.ChecksumURL == "" {
		t.Fatalf("unexpected update info: %+v err=%v", info, err)
	}

	dir := t.TempDir()
	exe := filepath.Join(dir, "cursor-zh.exe")
	if err := os.WriteFile(exe, []byte("old binary"), 0755); err != nil {
		t.Fatal(err)
	}
	tmp, err := u.DownloadUpdate(info, exe)
	if err != nil {
		t.Fatalf("DownloadUpdate: %v", err)
	}
	if err := InstallUpdate(tmp, exe); err != nil {
		t.Fatalf("InstallUpdate: %v", err)
	}
	if got, _ := os.ReadFile(exe); string(got) != string(payload) {
		t.Errorf("exe not replaced, got %q", got)
	}
	CleanupOldBinary(exe)
	if _, err := os.Stat(exe + ".old"); !os.IsNotExist(err) {
		t.Error(".old binary not cleaned up")
	}

	if info, err := u.CheckUpdate("v9.0.0"); err != nil || info.Available {
		t.Errorf("same version must not be available: %+v %v", info, err)
	}
}

func TestDownloadUpdateRejectsBadOrMissingHash(t *testing.T) {
	srv := newReleaseServer(t, []byte("payload"), "")
	u := NewUpdater("o/r")
	u.apiBase = srv.URL
	exe := filepath.Join(t.TempDir(), "cursor-zh.exe")

	bad := &UpdateInfo{Available: true, AssetName: "cursor-zh.exe", DownloadURL: srv.URL + "/dl/app.exe",
		SHA256: "0000000000000000000000000000000000000000000000000000000000000000"}
	if _, err := u.DownloadUpdate(bad, exe); err == nil {
		t.Error("expected hash mismatch error")
	}
	none := &UpdateInfo{Available: true, AssetName: "cursor-zh.exe", DownloadURL: srv.URL + "/dl/app.exe"}
	if _, err := u.DownloadUpdate(none, exe); err == nil {
		t.Error("expected refusal without SHA-256")
	}
	entries, _ := os.ReadDir(filepath.Dir(exe))
	if len(entries) != 0 {
		t.Errorf("temporary files left behind: %d", len(entries))
	}
}

func TestCheckUpdateNotConfigured(t *testing.T) {
	u := &Updater{}
	info, err := u.CheckUpdate("v1.0.0")
	if err != nil || info.Configured || info.Available {
		t.Errorf("unexpected: %+v %v", info, err)
	}
}
