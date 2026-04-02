package browser

import (
	"log"
	"os/exec"
)

// Open launches url in the best available browser.
// Priority: Chrome --app -> Edge --app -> system default.
func Open(url string) error {
	appArgs := []string{"--app=" + url, "--new-window", "--disable-extensions", "--window-size=1280,800"}

	if chrome := findChrome(); chrome != "" {
		log.Printf("Opening %s in Chrome --app mode", url)
		return exec.Command(chrome, appArgs...).Start()
	}
	if edge := findEdge(); edge != "" {
		log.Printf("Opening %s in Edge --app mode", url)
		return exec.Command(edge, appArgs...).Start()
	}

	log.Printf("No Chrome/Edge found, opening %s in default browser", url)
	return openDefault(url)
}

// OpenDefault opens url in the system default browser.
func OpenDefault(url string) error {
	return openDefault(url)
}
