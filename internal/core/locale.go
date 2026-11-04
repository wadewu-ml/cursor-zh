package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// cursorArgvPath follows Cursor's portable-data and normal startup configuration paths.
func cursorArgvPath(installDir string) (string, error) {
	if portable := portableDataDir(installDir); portable != "" {
		return filepath.Join(portable, "argv.json"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".cursor", "argv.json"), nil
}

// argvJSON removes JSONC comments and trailing commas without changing byte offsets.
// Offsets allow editing only the locale value, preserving all other settings and comments.
func argvJSON(data []byte) ([]byte, error) {
	clean := bytes.Clone(data)
	for i := 0; i < len(clean); i++ {
		switch clean[i] {
		case '"':
			for i++; i < len(clean); i++ {
				if clean[i] == '\\' {
					i++
				} else if clean[i] == '"' {
					break
				}
			}
		case '/':
			if i+1 >= len(clean) {
				continue
			}
			if clean[i+1] == '/' {
				for ; i < len(clean) && clean[i] != '\n' && clean[i] != '\r'; i++ {
					clean[i] = ' '
				}
			} else if clean[i+1] == '*' {
				end := bytes.Index(clean[i+2:], []byte("*/"))
				if end < 0 {
					return nil, fmt.Errorf("argv.json 注释未结束")
				}
				end += i + 4
				for ; i < end; i++ {
					if clean[i] != '\n' && clean[i] != '\r' {
						clean[i] = ' '
					}
				}
				i--
			}
		}
	}
	// A comma is trailing only when its next non-whitespace token closes a container.
	inString := false
	for i := 0; i < len(clean); i++ {
		if inString && clean[i] == '\\' {
			i++
		} else if clean[i] == '"' {
			inString = !inString
		} else if !inString && clean[i] == ',' {
			next := bytes.TrimLeft(clean[i+1:], " \t\r\n")
			if len(next) > 0 && (next[0] == '}' || next[0] == ']') {
				clean[i] = ' '
			}
		}
	}
	var config map[string]json.RawMessage
	if err := json.Unmarshal(clean, &config); err != nil {
		return nil, fmt.Errorf("解析 argv.json 失败: %w", err)
	}
	if config == nil {
		return nil, fmt.Errorf("argv.json 必须是 JSON 对象")
	}
	return clean, nil
}

func readConfiguredLocale(installDir string) string {
	path, err := cursorArgvPath(installDir)
	if err != nil {
		return ""
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	clean, err := argvJSON(data)
	if err != nil {
		return ""
	}
	var config struct {
		Locale string `json:"locale"`
	}
	_ = json.Unmarshal(clean, &config)
	return config.Locale
}

func (in *Installer) setupLocale(installDir string) error {
	locale := resourceLanguage(in.fsys).locale
	path, err := cursorArgvPath(installDir)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		data = []byte("{\n}\n")
	} else if err != nil {
		return err
	}
	clean, err := argvJSON(data)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(clean))
	_, _ = decoder.Token() // argvJSON has validated the root object.
	start, end, count := -1, -1, 0
	for decoder.More() {
		key, _ := decoder.Token()
		var value json.RawMessage
		_ = decoder.Decode(&value)
		if key == "locale" {
			end = int(decoder.InputOffset())
			start = end - len(value)
		}
		count++
	}
	if start >= 0 {
		encoded, _ := json.Marshal(locale)
		data = append(append(append([]byte(nil), data[:start]...), encoded...), data[end:]...)
	} else {
		// Insert first so an existing trailing comma and trailing comments stay intact.
		open := bytes.IndexByte(clean, '{') + 1
		field := "\n  \"locale\": \"" + locale + "\""
		if count > 0 {
			field += ","
		}
		data = append(append(append([]byte(nil), data[:open]...), []byte(field+"\n")...), data[open:]...)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return atomicWriteFile(path, data, 0644)
}
