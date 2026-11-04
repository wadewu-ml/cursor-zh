param(
    [string]$Version = "v1.1.0",
    [string]$Repo = "wadewu-ml/cursor-zh"
)

$ErrorActionPreference = 'Stop'

Push-Location -LiteralPath $PSScriptRoot
try {
    $ldflags = "-X cursor-zh/internal/core.AppVersion=$Version -X cursor-zh/internal/core.DefaultRepoPath=$Repo"
    & go run github.com/wailsapp/wails/v2/cmd/wails@v2.16.0 build -trimpath -ldflags $ldflags
    if ($LASTEXITCODE -ne 0) {
        throw "Windows build failed (exit $LASTEXITCODE)."
    }
} finally {
    Pop-Location
}
