package core

import (
	_ "embed"
	"encoding/json"
	"io/fs"
	"path"
	"sort"
	"strings"
)

// These locale IDs match Cursor's language packs, not public script labels.
const (
	SimplifiedChinese  = "zh-cn"
	TraditionalChinese = "zh-tw"
)

type languageProfile struct {
	locale      string
	name        string
	extensionID string
	vsix        string
}

func languageFor(locale string) languageProfile {
	if locale == TraditionalChinese {
		return languageProfile{TraditionalChinese, "繁體中文", "ms-ceintl.vscode-language-pack-zh-hant", "VSCode-language-pack-zh-hant.vsix"}
	}
	return languageProfile{SimplifiedChinese, "简体中文", LanguagePackExtensionID, "VSCode-language-pack-zh-hans.vsix"}
}

//go:embed traditional.json
var traditionalData []byte

var traditionalTranslations = func() map[string]string {
	var translations map[string]string
	if err := json.Unmarshal(traditionalData, &translations); err != nil {
		panic(err)
	}
	return translations
}()

var traditionalReplacer = func() *strings.Replacer {
	keys := make([]string, 0, len(traditionalTranslations))
	for source := range traditionalTranslations {
		keys = append(keys, source)
	}
	sort.Slice(keys, func(left, right int) bool {
		if len(keys[left]) != len(keys[right]) {
			return len(keys[left]) > len(keys[right])
		}
		return keys[left] < keys[right]
	})
	pairs := make([]string, 0, len(keys)*2)
	for _, source := range keys {
		pairs = append(pairs, source, traditionalTranslations[source])
	}
	return strings.NewReplacer(pairs...)
}()

func TraditionalText(text string) string {
	return traditionalReplacer.Replace(text)
}

func DetectLocale(installDir string) string {
	return languageFor(strings.ToLower(readConfiguredLocale(installDir))).locale
}

func languageText(locale, text string) string {
	if locale == TraditionalChinese {
		return TraditionalText(text)
	}
	return text
}

type localizedFS struct {
	fs.FS
	locale string
}

func LocalizedResources(resources fs.FS, locale string) fs.FS {
	return localizedFS{baseResources(resources), languageFor(locale).locale}
}

func baseResources(resources fs.FS) fs.FS {
	if localized, ok := resources.(localizedFS); ok {
		return localized.FS
	}
	return resources
}

func resourceLanguage(resources fs.FS) languageProfile {
	if localized, ok := resources.(localizedFS); ok {
		return languageFor(localized.locale)
	}
	return languageFor(SimplifiedChinese)
}

func (resources localizedFS) ReadFile(name string) ([]byte, error) {
	data, err := fs.ReadFile(resources.FS, name)
	if err != nil || resources.locale != TraditionalChinese {
		return data, err
	}
	switch path.Ext(name) {
	case ".js":
		return []byte(TraditionalText(string(data))), nil
	case ".json":
		var dictionary any
		if err := json.Unmarshal(data, &dictionary); err != nil {
			return nil, err
		}
		translateDictionary(dictionary)
		return json.Marshal(dictionary)
	}
	return data, err
}

func translateDictionary(value any) {
	switch container := value.(type) {
	case map[string]any:
		for key, content := range container {
			switch key {
			case "entries", "replacements", "uiFragments", "descriptionFragments", "mcpEntries", "domainEntries", "patterns":
				switch entries := content.(type) {
				case []any:
					for _, entry := range entries {
						if pair, ok := entry.([]any); ok && len(pair) >= 2 {
							if text, ok := pair[1].(string); ok {
								pair[1] = TraditionalText(text)
								continue
							}
						}
						translateDictionary(entry)
					}
				case map[string]any:
					translateDictionaryValues(entries)
				}
			case "pluginNames", "uiLabels", "skillNames", "nameStems":
				if entries, ok := content.(map[string]any); ok {
					translateDictionaryValues(entries)
				}
			case "replacement", "replace", "zh", "zhAdmin", "tail":
				if text, ok := content.(string); ok {
					container[key] = TraditionalText(text)
				}
			default:
				translateDictionary(content)
			}
		}
	case []any:
		for _, entry := range container {
			translateDictionary(entry)
		}
	}
}

func translateDictionaryValues(entries map[string]any) {
	for key, value := range entries {
		if text, ok := value.(string); ok {
			entries[key] = TraditionalText(text)
		}
	}
}
