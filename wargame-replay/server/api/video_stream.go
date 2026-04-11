package api

import (
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// StreamVideo handles GET /api/video-stream/:token where token is the
// URL-safe base64 encoding of the segment's absolute path.
//
// Path safety relies on the scanner: a token only resolves if the
// decoded absolute path lives under at least one currently registered
// source directory (Scanner.IsInsideSource, which symlink-resolves both
// sides).  This replaces the old single-root containment check.
func (h *Handler) StreamVideo(c *gin.Context) {
	scanner := h.videoScanner
	if scanner == nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	token := c.Param("token")
	token = strings.TrimPrefix(token, "/")
	if token == "" {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Decode the token back to an absolute path. URL-safe base64 without
	// padding keeps it clean in URLs.
	rawBytes, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	absPath := string(rawBytes)
	if absPath == "" || !filepath.IsAbs(absPath) {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	absPath = filepath.Clean(absPath)

	// Containment check: the path (after resolving symlinks) must lie
	// beneath one of the registered source directories.
	if !scanner.IsInsideSource(absPath) {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	f, err := os.Open(absPath)
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

	c.Header("Content-Type", mimeTypeForExt(absPath))
	c.Header("Accept-Ranges", "bytes")
	// Prevent intermediate caches from storing large video chunks they
	// cannot re-serve efficiently. The browser still uses its own HTTP
	// cache, which gives it what it needs for seek-back.
	c.Header("Cache-Control", "no-store")
	http.ServeContent(c.Writer, c.Request, stat.Name(), stat.ModTime(), f)
}

// EncodeStreamToken returns the URL-safe base64 token for a given
// absolute path. Exported so other server-side code (tests, handlers
// building preload URLs) can build stable stream URLs without duplicating
// the encoding rules.
func EncodeStreamToken(absPath string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(absPath))
}

// mimeTypeForExt returns the Content-Type to advertise for a given path.
// The mime package is deliberately avoided to keep the set small and
// predictable.
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
