package core

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"
)

// BuildMarkerPrefix tags generated runtime files with a content hash of the embedded build.
const BuildMarkerPrefix = "// CURSOR_ZH_BUILD: "

// Builder compiles JavaScript runtime payload from dictionary files and runtime fragments.
type Builder struct {
	fsys fs.FS
}

func NewBuilder(fsys fs.FS) *Builder {
	return &Builder{fsys: fsys}
}

func (b *Builder) readFS(path string) ([]byte, error) {
	return fs.ReadFile(b.fsys, path)
}

// BuildJavaScript combines runtime files and dictionaries into a single cursor-zh-runtime.js payload.
// The first line is a build marker holding the SHA-256 of the remaining content, so the detector can
// tell whether the installed script is intact and matches this build.
func (b *Builder) BuildJavaScript() (string, error) {
	body, err := b.buildBody()
	if err != nil {
		return "", err
	}
	return BuildMarkerPrefix + ContentHash(body) + "\n" + body, nil
}

// ContentHash returns the hex SHA-256 used in build markers.
func ContentHash(body string) string {
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:])
}

// ParseBuildMarker splits a generated script into its declared hash and body.
func ParseBuildMarker(content string) (hash string, body string, ok bool) {
	content = strings.TrimPrefix(content, "\ufeff")
	if !strings.HasPrefix(content, BuildMarkerPrefix) {
		return "", content, false
	}
	nl := strings.IndexByte(content, '\n')
	if nl < 0 {
		return "", content, false
	}
	hash = strings.TrimSpace(strings.TrimPrefix(content[:nl], BuildMarkerPrefix))
	return hash, content[nl+1:], hash != ""
}

func (b *Builder) buildBody() (string, error) {
	var parts []string
	parts = append(parts, fmt.Sprintf("    var localizationLocale = %q;", resourceLanguage(b.fsys).locale))

	// 1. bootstrap.js
	bootstrapRaw, err := b.readFS("localization/runtime/bootstrap.js")
	if err != nil {
		return "", fmt.Errorf("read bootstrap.js failed: %w", err)
	}
	// Deterministic output: the build hash identifies the embedded dictionary version.
	bootstrap := strings.ReplaceAll(string(bootstrapRaw), "__BUILD_TIMESTAMP__", "cursor-zh "+AppVersion)
	parts = append(parts, strings.TrimRight(bootstrap, "\r\n"))

	// 2. Core Dictionary Map
	coreJS, err := b.buildCoreDictionaryJS()
	if err != nil {
		return "", fmt.Errorf("build core dictionary JS failed: %w", err)
	}
	parts = append(parts, strings.TrimRight(coreJS, "\r\n"))

	// 3. Ad Popup Merge
	adPopupJS, err := b.buildAdPopupJS()
	if err == nil && adPopupJS != "" {
		parts = append(parts, strings.TrimRight(adPopupJS, "\r\n"))
	}

	// 4. Pattern Dictionary Regex Array
	patternJS, err := b.buildPatternJS()
	if err != nil {
		return "", fmt.Errorf("build pattern JS failed: %w", err)
	}
	parts = append(parts, strings.TrimRight(patternJS, "\r\n"))

	// 5. engine.js with inserted fragments, keywords, helpers
	engineRaw, err := b.readFS("localization/runtime/engine.js")
	if err != nil {
		return "", fmt.Errorf("read engine.js failed: %w", err)
	}
	engine := string(engineRaw)

	partialJS, err := b.buildFragmentArrayJS("PARTIAL_FRAGMENTS", "localization/Partial_Fragments.json", "entries")
	if err == nil {
		engine = strings.ReplaceAll(engine, "    // __PARTIAL_FRAGMENTS_BLOCK__", partialJS)
	}

	dropdownJS, err := b.buildFragmentArrayJS("DROPDOWN_FRAGMENTS", "localization/Dropdown_Fragments.json", "entries")
	if err == nil {
		engine = strings.ReplaceAll(engine, "    // __DROPDOWN_FRAGMENTS_BLOCK__", dropdownJS)
	}

	settingsJS, err := b.buildSettingsFragmentsJS()
	if err == nil {
		engine = strings.ReplaceAll(engine, "    // __CURSOR_SETTINGS_FRAGMENTS_BLOCK__", settingsJS)
	}

	// Insert keywords
	keywordsRaw, err := b.readFS("localization/runtime/keywords.js")
	if err == nil {
		marker := "    function getDocumentText()"
		if idx := strings.Index(engine, marker); idx != -1 && !strings.Contains(engine, "var DOCUMENT_KEYWORD_GROUPS") {
			engine = engine[:idx] + strings.TrimRight(string(keywordsRaw), "\r\n") + "\n\n" + engine[idx:]
		}
	}

	// Insert helpers
	helpersRaw, err := b.readFS("localization/runtime/helpers.js")
	if err == nil {
		marker := "    function localizeCodebaseDescription()"
		if idx := strings.Index(engine, marker); idx != -1 {
			engine = engine[:idx] + strings.TrimRight(string(helpersRaw), "\r\n") + "\n\n" + engine[idx:]
		} else {
			engine = strings.TrimRight(engine, "\r\n") + "\n\n" + string(helpersRaw)
		}
	}
	parts = append(parts, strings.TrimRight(engine, "\r\n"))

	// 6. market.js
	marketRaw, err := b.readFS("localization/runtime/market.js")
	if err != nil {
		return "", fmt.Errorf("read market.js failed: %w", err)
	}
	market := string(marketRaw)
	marketBlock, err := b.buildMarketplaceBlock()
	if err == nil && marketBlock != "" {
		market = strings.ReplaceAll(market, "    // __PLUGIN_MARKETPLACE_BLOCK__", strings.TrimRight(marketBlock, "\r\n"))
	}
	parts = append(parts, strings.TrimRight(market, "\r\n"))

	// 7. init.js
	initRaw, err := b.readFS("localization/runtime/init.js")
	if err != nil {
		return "", fmt.Errorf("read init.js failed: %w", err)
	}
	parts = append(parts, strings.TrimRight(string(initRaw), "\r\n"))

	return strings.Join(parts, "\n\n") + "\n", nil
}

func (b *Builder) buildCoreDictionaryJS() (string, error) {
	data, err := b.readFS("localization/Core_Dictionary.json")
	if err != nil {
		return "", err
	}
	var raw struct {
		Sections []struct {
			Entries [][]string `json:"entries"`
		} `json:"sections"`
		Entries [][]string `json:"entries"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", err
	}

	merged := make(map[string]string)
	var orderedKeys []string
	addEntry := func(k, v string) {
		if k == "" || v == "" {
			return
		}
		if _, exists := merged[k]; !exists {
			orderedKeys = append(orderedKeys, k)
		}
		merged[k] = v
	}

	for _, sec := range raw.Sections {
		for _, pair := range sec.Entries {
			if len(pair) >= 2 {
				addEntry(pair[0], pair[1])
			}
		}
	}
	for _, pair := range raw.Entries {
		if len(pair) >= 2 {
			addEntry(pair[0], pair[1])
		}
	}

	var pairs [][]string
	for _, k := range orderedKeys {
		pairs = append(pairs, []string{k, merged[k]})
	}

	jsonBytes, err := json.Marshal(pairs)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("    var translationDictionary = new Map(%s);", string(jsonBytes)), nil
}

func (b *Builder) buildAdPopupJS() (string, error) {
	data, err := b.readFS("localization/Ad_Popup_Dictionary.json")
	if err != nil {
		return "", nil
	}
	var raw struct {
		Entries any `json:"entries"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", nil
	}

	var pairs [][]string
	switch v := raw.Entries.(type) {
	case map[string]any:
		for k, val := range v {
			if s, ok := val.(string); ok && k != "" && s != "" {
				pairs = append(pairs, []string{k, s})
			}
		}
	case []any:
		for _, item := range v {
			if arr, ok := item.([]any); ok && len(arr) >= 2 {
				if k, ok1 := arr[0].(string); ok1 && k != "" {
					if val, ok2 := arr[1].(string); ok2 && val != "" {
						pairs = append(pairs, []string{k, val})
					}
				}
			}
		}
	}
	if len(pairs) == 0 {
		return "", nil
	}
	jsonBytes, _ := json.Marshal(pairs)
	return fmt.Sprintf(`    (function() {
        var notificationEntries = %s;
        for (var gi = 0; gi < notificationEntries.length; gi++) {
            translationDictionary.set(notificationEntries[gi][0], notificationEntries[gi][1]);
        }
    })();`, string(jsonBytes)), nil
}

func (b *Builder) buildPatternJS() (string, error) {
	data, err := b.readFS("localization/Pattern_Dictionary.json")
	if err != nil {
		return "", err
	}
	var raw struct {
		Patterns []struct {
			Regex       string `json:"regex"`
			Flags       string `json:"flags"`
			Replacement string `json:"replacement"`
		} `json:"patterns"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", err
	}

	var lines []string
	for _, p := range raw.Patterns {
		if p.Regex == "" {
			continue
		}
		regexBytes, _ := json.Marshal(p.Regex)
		flagsBytes, _ := json.Marshal(p.Flags)
		replBytes, _ := json.Marshal(p.Replacement)
		lines = append(lines, fmt.Sprintf("        [new RegExp(%s, %s), %s]", string(regexBytes), string(flagsBytes), string(replBytes)))
	}
	if len(lines) == 0 {
		return "    var translationPatterns = [];", nil
	}
	return "    var translationPatterns = [\n" + strings.Join(lines, ",\n") + "\n    ];", nil
}

func (b *Builder) buildFragmentArrayJS(varName, filePath, key string) (string, error) {
	data, err := b.readFS(filePath)
	if err != nil {
		return fmt.Sprintf("    var %s = [];", varName), nil
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Sprintf("    var %s = [];", varName), nil
	}
	rawList, ok := raw[key].([]any)
	if !ok || len(rawList) == 0 {
		return fmt.Sprintf("    var %s = [];", varName), nil
	}
	var lines []string
	for _, item := range rawList {
		if arr, ok := item.([]any); ok && len(arr) >= 2 {
			k, ok1 := arr[0].(string)
			v, ok2 := arr[1].(string)
			if ok1 && ok2 && k != "" && v != "" {
				kB, _ := json.Marshal(k)
				vB, _ := json.Marshal(v)
				lines = append(lines, fmt.Sprintf("        [%s, %s],", string(kB), string(vB)))
			}
		}
	}
	if len(lines) == 0 {
		return fmt.Sprintf("    var %s = [];", varName), nil
	}
	return fmt.Sprintf("    var %s = [\n%s\n    ];", varName, strings.Join(lines, "\n")), nil
}

func (b *Builder) buildSettingsFragmentsJS() (string, error) {
	data, err := b.readFS("localization/Cursor_Settings_Fragments.json")
	if err != nil {
		return "", err
	}
	var raw struct {
		Symlink struct {
			Zh      string `json:"zh"`
			ZhAdmin string `json:"zhAdmin"`
			Tail    string `json:"tail"`
		} `json:"symlink"`
	}
	_ = json.Unmarshal(data, &raw)
	zhB, _ := json.Marshal(raw.Symlink.Zh)
	zhAdminB, _ := json.Marshal(raw.Symlink.ZhAdmin)
	tailB, _ := json.Marshal(raw.Symlink.Tail)

	mcpJS, _ := b.buildFragmentArrayJS("SETTINGS_MCP_FRAGMENTS", "localization/Cursor_Settings_Fragments.json", "mcpEntries")
	domainJS, _ := b.buildFragmentArrayJS("SETTINGS_DOMAIN_FRAGMENTS", "localization/Cursor_Settings_Fragments.json", "domainEntries")

	parts := []string{
		fmt.Sprintf("    var SETTINGS_SYMLINK_TEXT = %s;", string(zhB)),
		fmt.Sprintf("    var SETTINGS_SYMLINK_ADMIN_TEXT = %s;", string(zhAdminB)),
		fmt.Sprintf("    var SETTINGS_SYMLINK_TAIL = %s;", string(tailB)),
		mcpJS,
		domainJS,
	}
	return strings.Join(parts, "\n"), nil
}

func (b *Builder) buildMarketplaceBlock() (string, error) {
	data, err := b.readFS("localization/Plugin_Marketplace_Dictionary.json")
	if err != nil {
		return "", nil
	}
	var raw struct {
		PluginNames          map[string]string `json:"pluginNames"`
		UILabels             map[string]string `json:"uiLabels"`
		UIFragments          [][]string        `json:"uiFragments"`
		Patterns             []any             `json:"patterns"`
		SkillNames           map[string]string `json:"skillNames"`
		NameStems            map[string]string `json:"nameStems"`
		DescriptionFragments [][]string        `json:"descriptionFragments"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", fmt.Errorf("parse Plugin_Marketplace_Dictionary.json failed: %w", err)
	}

	pNamesB, _ := json.MarshalIndent(raw.PluginNames, "            ", "    ")
	uiLabelsB, _ := json.MarshalIndent(raw.UILabels, "            ", "    ")
	uiFragsB, _ := json.MarshalIndent(raw.UIFragments, "            ", "    ")
	skillNamesB, _ := json.MarshalIndent(raw.SkillNames, "            ", "    ")
	nameStemsB, _ := json.MarshalIndent(raw.NameStems, "            ", "    ")
	descFragsB, _ := json.MarshalIndent(raw.DescriptionFragments, "            ", "    ")
	patternsJS := marketplacePatternsJS(raw.Patterns)

	return fmt.Sprintf(`    function getMarketplaceDictionaryPayload() {
        return {
            pluginNames: %s,
            uiLabels: %s,
            uiFragments: %s,
            patterns: %s,
            skillNames: %s,
            nameStems: %s,
            descriptionFragments: %s
        };
    }`, string(pNamesB), string(uiLabelsB), string(uiFragsB), patternsJS, string(skillNamesB), string(nameStemsB), string(descFragsB)), nil
}

// marketplacePatternsJS accepts regex/flags/replace objects (replacement is also accepted)
// or arrays in the form [regex, replace, flags?].
func marketplacePatternsJS(items []any) string {
	var lines []string
	for _, item := range items {
		var regex, flags, repl string
		flags = "i"
		switch v := item.(type) {
		case map[string]any:
			regex, _ = v["regex"].(string)
			if f, ok := v["flags"].(string); ok {
				flags = f
			}
			if r, ok := v["replace"].(string); ok {
				repl = r
			} else if r, ok := v["replacement"].(string); ok {
				repl = r
			}
		case []any:
			if len(v) < 2 {
				continue
			}
			regex = fmt.Sprint(v[0])
			repl = fmt.Sprint(v[1])
			if len(v) > 2 {
				flags = fmt.Sprint(v[2])
			}
		default:
			continue
		}
		if regex == "" {
			continue
		}
		rB, _ := json.Marshal(regex)
		fB, _ := json.Marshal(flags)
		pB, _ := json.Marshal(repl)
		lines = append(lines, fmt.Sprintf("                [new RegExp(%s, %s), %s]", rB, fB, pB))
	}
	if len(lines) == 0 {
		return "[]"
	}
	return "[\n" + strings.Join(lines, ",\n") + "\n            ]"
}
