package core

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// fileTxn snapshots files before modification so a failed operation can be rolled back.
type fileTxn struct {
	snaps []fileSnapshot
	seen  map[string]bool
}

type fileSnapshot struct {
	path   string
	exists bool
	data   []byte
	mode   os.FileMode
}

func newFileTxn() *fileTxn {
	return &fileTxn{seen: make(map[string]bool)}
}

// track records the current state of path. It must be called before the file is changed.
func (t *fileTxn) track(path string) error {
	key := filepath.Clean(path)
	if t.seen[key] {
		return nil
	}
	info, err := os.Stat(key)
	switch {
	case err == nil:
		data, readErr := os.ReadFile(key)
		if readErr != nil {
			return fmt.Errorf("备份 %s 失败: %w", key, readErr)
		}
		t.snaps = append(t.snaps, fileSnapshot{path: key, exists: true, data: data, mode: info.Mode().Perm()})
	case os.IsNotExist(err):
		t.snaps = append(t.snaps, fileSnapshot{path: key})
	default:
		return fmt.Errorf("备份 %s 失败: %w", key, err)
	}
	t.seen[key] = true
	return nil
}

// rollback restores every tracked file, skipping files whose content is already unchanged.
func (t *fileTxn) rollback() error {
	var errs []error
	for i := len(t.snaps) - 1; i >= 0; i-- {
		s := t.snaps[i]
		current, err := os.ReadFile(s.path)
		if !s.exists {
			if err == nil {
				if rmErr := os.Remove(s.path); rmErr != nil && !os.IsNotExist(rmErr) {
					errs = append(errs, fmt.Errorf("删除 %s 失败: %w", s.path, rmErr))
				}
			}
			continue
		}
		if err == nil && bytes.Equal(current, s.data) {
			continue
		}
		if wErr := atomicWriteFile(s.path, s.data, s.mode); wErr != nil {
			errs = append(errs, fmt.Errorf("还原 %s 失败: %w", s.path, wErr))
		}
	}
	return errors.Join(errs...)
}

// failWithRollback rolls back and wraps the original error with the rollback outcome.
func (t *fileTxn) failWithRollback(stage string, err error) error {
	if rbErr := t.rollback(); rbErr != nil {
		return fmt.Errorf("%s: %w；回滚未完全成功: %v", stage, err, rbErr)
	}
	return fmt.Errorf("%s: %w（已回滚本次修改）", stage, err)
}
