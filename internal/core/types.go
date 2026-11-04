package core

import "time"

// LocalizationState describes the patch state of Cursor installation.
type LocalizationState string

const (
	StateNotFound          LocalizationState = "not_found"
	StateRunning           LocalizationState = "cursor_running"
	StateUnpatched         LocalizationState = "unpatched"
	StatePatchedCurrent    LocalizationState = "patched_current"
	StatePatchedOutdated   LocalizationState = "patched_outdated"
	StateCorruptedChecksum LocalizationState = "corrupted_checksum"
	StateIncompatible      LocalizationState = "incompatible"
)

// CursorStatus holds comprehensive inspection information about Cursor.
type CursorStatus struct {
	Locale              string            `json:"locale"`
	State               LocalizationState `json:"state"`
	InstallDir          string            `json:"installDir"`
	UserDataDir         string            `json:"userDataDir"`
	CursorVersion       string            `json:"cursorVersion"`
	VSCodeVersion       string            `json:"vscodeVersion"`
	ExecutablePath      string            `json:"executablePath"`
	WorkbenchHTMLPath   string            `json:"workbenchHtmlPath"`
	IsRunning           bool              `json:"isRunning"`
	HasLanguagePack     bool              `json:"hasLanguagePack"`
	HasScriptInjection  bool              `json:"hasScriptInjection"`
	HasTrayPatch        bool              `json:"hasTrayPatch"`
	HasValidScript      bool              `json:"hasValidScript"`
	LocalizationBuild   string            `json:"localizationBuild"`
	ChecksumsValid      bool              `json:"checksumsValid"`
	MismatchedChecksums []string          `json:"mismatchedChecksums"`
	Message             string            `json:"message"`
	CanApply            bool              `json:"canApply"`
	CanRestore          bool              `json:"canRestore"`
}

// ActionResult is returned to frontend for any user action.
type ActionResult struct {
	Success bool     `json:"success"`
	Message string   `json:"message"`
	Logs    []string `json:"logs"`
	Error   string   `json:"error,omitempty"`
}

// UpdateInfo represents an available application update.
type UpdateInfo struct {
	Available      bool      `json:"available"`
	CurrentVersion string    `json:"currentVersion"`
	LatestVersion  string    `json:"latestVersion"`
	ReleaseNotes   string    `json:"releaseNotes"`
	DownloadURL    string    `json:"downloadUrl"`
	AssetName      string    `json:"assetName"`
	ChecksumURL    string    `json:"checksumUrl"`
	SHA256         string    `json:"sha256"`
	Configured     bool      `json:"configured"`
	PublishedAt    time.Time `json:"publishedAt,omitempty"`
	Error          string    `json:"error,omitempty"`
}
