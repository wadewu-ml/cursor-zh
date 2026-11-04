package core

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Release metadata; override at build time, e.g.
// -ldflags "-X cursor-zh/internal/core.AppVersion=v1.2.0 -X cursor-zh/internal/core.DefaultRepoPath=owner/repo"
var (
	AppVersion      = "v1.1.0"
	DefaultRepoPath = "wadewu-ml/cursor-zh"
)

// ReleaseAssetPrefix identifies the portable helper executable among release assets.
const ReleaseAssetPrefix = "cursor-zh"

// Updater checks GitHub releases and replaces the running portable executable.
type Updater struct {
	repo    string
	apiBase string
	client  *http.Client
}

func NewUpdater(repo string) *Updater {
	if repo == "" {
		repo = DefaultRepoPath
	}
	return &Updater{repo: repo, apiBase: "https://api.github.com", client: &http.Client{Timeout: 30 * time.Second}}
}

// Configured reports whether an update source is set.
func (u *Updater) Configured() bool { return u.repo != "" }

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// CheckUpdate queries GitHub for the latest release.
func (u *Updater) CheckUpdate(currentVersion string) (*UpdateInfo, error) {
	info := &UpdateInfo{CurrentVersion: currentVersion, LatestVersion: currentVersion, Configured: u.Configured()}
	if !u.Configured() {
		info.ReleaseNotes = "未配置更新源（本地构建版本），无法自动更新。"
		return info, nil
	}

	req, err := http.NewRequest("GET", fmt.Sprintf("%s/repos/%s/releases/latest", u.apiBase, u.repo), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "cursor-zh/"+currentVersion)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("检查更新网络请求失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		info.ReleaseNotes = "暂无已发布的 Release 版本。"
		return info, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API 返回状态码 %d", resp.StatusCode)
	}

	var rel struct {
		TagName     string    `json:"tag_name"`
		Body        string    `json:"body"`
		PublishedAt time.Time `json:"published_at"`
		Assets      []ghAsset `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("解析 Release 信息失败: %w", err)
	}

	info.LatestVersion = rel.TagName
	info.ReleaseNotes = rel.Body
	info.PublishedAt = rel.PublishedAt
	cmp, err := CompareVersions(rel.TagName, currentVersion)
	if err != nil {
		return nil, err
	}
	if cmp <= 0 {
		return info, nil
	}

	exe := selectExeAsset(rel.Assets)
	if exe == nil {
		return nil, fmt.Errorf("Release %s 中没有 %s*.exe 可执行文件", rel.TagName, ReleaseAssetPrefix)
	}
	info.Available = true
	info.AssetName = exe.Name
	info.DownloadURL = exe.BrowserDownloadURL
	info.SHA256 = sha256FromText(rel.Body, exe.Name)
	if info.SHA256 == "" {
		info.ChecksumURL = selectChecksumAsset(rel.Assets, exe.Name)
	}
	return info, nil
}

func selectExeAsset(assets []ghAsset) *ghAsset {
	var fallback *ghAsset
	for i := range assets {
		name := strings.ToLower(assets[i].Name)
		if !strings.HasSuffix(name, ".exe") {
			continue
		}
		if strings.HasPrefix(name, strings.ToLower(ReleaseAssetPrefix)) {
			return &assets[i]
		}
		if fallback == nil {
			fallback = &assets[i]
		}
	}
	return fallback
}

func selectChecksumAsset(assets []ghAsset, exeName string) string {
	for _, want := range []string{exeName + ".sha256", "sha256sums.txt", "sha256sums", "checksums.txt"} {
		for _, a := range assets {
			if strings.EqualFold(a.Name, want) {
				return a.BrowserDownloadURL
			}
		}
	}
	return ""
}

var reHex64 = regexp.MustCompile(`(?i)\b[0-9a-f]{64}\b`)

// sha256FromText finds the SHA-256 for fileName in sha256sum-style text or release notes.
// A line naming the file wins; otherwise a sole hash in the text is accepted.
func sha256FromText(text, fileName string) string {
	var all []string
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		line := sc.Text()
		hashes := reHex64.FindAllString(line, -1)
		if len(hashes) == 0 {
			continue
		}
		if fileName != "" && strings.Contains(strings.ToLower(line), strings.ToLower(fileName)) {
			return strings.ToLower(hashes[0])
		}
		all = append(all, hashes...)
	}
	if len(all) == 1 {
		return strings.ToLower(all[0])
	}
	return ""
}

// CompareVersions compares semantic versions (optional leading v). Pre-release sorts below release.
func CompareVersions(a, b string) (int, error) {
	pa, err := parseSemver(a)
	if err != nil {
		return 0, err
	}
	pb, err := parseSemver(b)
	if err != nil {
		return 0, err
	}
	for i := 0; i < 3; i++ {
		if pa.nums[i] != pb.nums[i] {
			if pa.nums[i] > pb.nums[i] {
				return 1, nil
			}
			return -1, nil
		}
	}
	switch {
	case pa.pre == pb.pre:
		return 0, nil
	case pa.pre == "":
		return 1, nil
	case pb.pre == "":
		return -1, nil
	case pa.pre > pb.pre:
		return 1, nil
	default:
		return -1, nil
	}
}

type semver struct {
	nums [3]int
	pre  string
}

func parseSemver(v string) (semver, error) {
	var out semver
	s := strings.TrimLeft(strings.TrimSpace(v), "vV")
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, '-'); i >= 0 {
		out.pre, s = s[i+1:], s[:i]
	}
	parts := strings.Split(s, ".")
	if len(parts) > 3 || parts[0] == "" {
		return out, fmt.Errorf("无法解析版本号 %q", v)
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return out, fmt.Errorf("无法解析版本号 %q", v)
		}
		out.nums[i] = n
	}
	return out, nil
}

// DownloadUpdate downloads the release executable next to exePath and verifies its SHA-256.
// It returns the verified temporary file path.
func (u *Updater) DownloadUpdate(info *UpdateInfo, exePath string) (string, error) {
	if info == nil || !info.Available || info.DownloadURL == "" {
		return "", errors.New("没有可用的更新")
	}
	expected := strings.ToLower(info.SHA256)
	if expected == "" && info.ChecksumURL != "" {
		text, err := u.fetchText(info.ChecksumURL)
		if err != nil {
			return "", fmt.Errorf("下载校验文件失败: %w", err)
		}
		expected = sha256FromText(text, info.AssetName)
	}
	if expected == "" {
		return "", errors.New("Release 未提供 SHA-256 校验值，已拒绝更新")
	}

	resp, err := u.get(info.DownloadURL)
	if err != nil {
		return "", fmt.Errorf("下载更新失败: %w", err)
	}
	defer resp.Body.Close()

	// Same directory keeps the final rename on one volume.
	tmp, err := os.CreateTemp(filepath.Dir(exePath), ".update-*.exe")
	if err != nil {
		return "", fmt.Errorf("创建临时文件失败: %w", err)
	}
	h := sha256.New()
	_, copyErr := io.Copy(io.MultiWriter(tmp, h), resp.Body)
	closeErr := tmp.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(tmp.Name())
		return "", fmt.Errorf("保存更新失败: %v", errors.Join(copyErr, closeErr))
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != expected {
		os.Remove(tmp.Name())
		return "", fmt.Errorf("SHA-256 校验失败：期望 %s，实际 %s", expected, got)
	}
	return tmp.Name(), nil
}

// InstallUpdate swaps the verified file into exePath. Windows allows renaming a running
// executable, so the current binary is moved aside to exePath+".old" and removed on next start.
func InstallUpdate(newPath, exePath string) error {
	oldPath := exePath + ".old"
	_ = os.Remove(oldPath)
	if err := os.Rename(exePath, oldPath); err != nil {
		return fmt.Errorf("移开当前程序失败: %w", err)
	}
	if err := os.Rename(newPath, exePath); err != nil {
		if rbErr := os.Rename(oldPath, exePath); rbErr != nil {
			return fmt.Errorf("替换程序失败: %w；恢复原程序也失败: %v（原程序在 %s）", err, rbErr, oldPath)
		}
		return fmt.Errorf("替换程序失败，已恢复原程序: %w", err)
	}
	return nil
}

// CleanupOldBinary removes the previous executable left by InstallUpdate.
func CleanupOldBinary(exePath string) {
	_ = os.Remove(exePath + ".old")
}

func (u *Updater) get(url string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "cursor-zh/"+AppVersion)
	client := *u.client
	client.Timeout = 10 * time.Minute
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return resp, nil
}

func (u *Updater) fetchText(url string) (string, error) {
	resp, err := u.get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return string(data), err
}
