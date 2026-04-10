package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// StreamVideo handles GET /api/video-stream/*relPath.
//
// It streams a file from the configured video root using http.ServeContent,
// which gives us Range / If-Modified-Since / ETag support for free.  Path
// safety is enforced in three layers: filepath.Clean, explicit ".." rejection,
// and EvalSymlinks containment within the root directory.
func (h *Handler) StreamVideo(c *gin.Context) {
	scanner := h.videoScanner
	if scanner == nil || !scanner.Enabled() {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	root := scanner.RootDir()

	raw := c.Param("relPath")
	raw = strings.TrimPrefix(raw, "/")
	if raw == "" {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// filepath.Clean normalises separators and collapses "." / ".." pairs.
	clean := filepath.Clean(raw)
	if filepath.IsAbs(clean) {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	// After cleaning, any remaining ".." means the input tried to escape.
	// On POSIX `a/../b` would collapse to `b`, but something like `../../x`
	// collapses to `../../x` because there is no parent to ascend into.
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || clean == "." {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	absPath := filepath.Join(root, clean)
	// Symlink containment: resolve both sides and verify that the real path
	// lives inside the real root directory. This defeats symlinks that point
	// outside the video root.
	realAbs, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	rel, err := filepath.Rel(realRoot, realAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	f, err := os.Open(realAbs)
	if err != nil {
		if os.IsNotExist(err) {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	if stat.IsDir() {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	c.Header("Content-Type", mimeTypeForExt(realAbs))
	c.Header("Accept-Ranges", "bytes")
	// Prevent intermediate caches from storing large video chunks they
	// cannot re-serve efficiently.  The browser still uses its own HTTP
	// cache, which gives it what it needs for seek-back.
	c.Header("Cache-Control", "no-store")
	http.ServeContent(c.Writer, c.Request, stat.Name(), stat.ModTime(), f)
}

// mimeTypeForExt returns the Content-Type to advertise for a given path.  The
// mime package is deliberately avoided to keep the set small and predictable.
func mimeTypeForExt(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".mkv":
		return "video/x-matroska"
	}
	return "application/octet-stream"
}
