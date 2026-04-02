//go:build windows

package main

import (
	"log"
	"os"
	"path/filepath"
	"syscall"
)

const ATTACH_PARENT_PROCESS = ^uint32(0) // 0xFFFFFFFF

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procAttachConsole = kernel32.NewProc("AttachConsole")
)

func init() {
	// Try to attach to parent console (e.g., when launched from PowerShell).
	r, _, _ := procAttachConsole.Call(uintptr(ATTACH_PARENT_PROCESS))
	if r != 0 {
		return
	}

	// No parent console (double-click launch) — redirect logs to file
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return
	}
	logDir := filepath.Join(localAppData, "MilSimReplay")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return
	}
	logPath := filepath.Join(logDir, "server.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(f)
}
