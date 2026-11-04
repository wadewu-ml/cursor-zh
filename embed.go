package main

import (
	"embed"
)

//go:embed all:frontend/dist
var assetsFS embed.FS

//go:embed localization/*.json localization/runtime/*.js VSCode-language-pack-zh-hans.vsix
var localizationFS embed.FS
