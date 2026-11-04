//go:build windows

package core

import (
	"os/exec"
	"syscall"
)

// hideWindow prevents console windows from flashing when the GUI runs helper commands.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
