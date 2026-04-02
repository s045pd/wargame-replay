package browser

import (
	"os"
	"os/exec"
	"runtime"
)

// findChrome returns the path to Chrome if installed, or "".
func findChrome() string {
	switch runtime.GOOS {
	case "darwin":
		p := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
		if _, err := os.Stat(p); err == nil {
			return p
		}
	case "windows":
		for _, base := range []string{
			os.Getenv("ProgramFiles"),
			os.Getenv("ProgramFiles(x86)"),
			os.Getenv("LocalAppData"),
		} {
			if base == "" {
				continue
			}
			p := base + `\Google\Chrome\Application\chrome.exe`
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	default: // linux
		for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	return ""
}

// findEdge returns the path to Edge if installed, or "".
func findEdge() string {
	switch runtime.GOOS {
	case "darwin":
		p := "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
		if _, err := os.Stat(p); err == nil {
			return p
		}
	case "windows":
		for _, base := range []string{
			os.Getenv("ProgramFiles(x86)"),
			os.Getenv("ProgramFiles"),
		} {
			if base == "" {
				continue
			}
			p := base + `\Microsoft\Edge\Application\msedge.exe`
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	default:
		for _, name := range []string{"microsoft-edge", "microsoft-edge-stable"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	return ""
}
