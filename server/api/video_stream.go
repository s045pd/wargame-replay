package api

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// StreamVideo handles GET /api/video-stream/:token
//
// Query parameters:
//
//	transcode=1  — force real-time HEVC→H.264 transcoding via ffmpeg.
//	seek=<sec>   — start position in seconds (only with transcode=1).
//
// Without transcode=1: direct HTTP Range streaming via ServeContent.
// With transcode=1: spawns ffmpeg, outputs fragmented MP4 to the
// response body. The client must set a new src (with updated seek=)
// for each seek — Range requests are not supported in this mode.
func (h *Handler) StreamVideo(c *gin.Context) {
	scanner := h.videoScanner
	if scanner == nil {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}

	absPath, ok := resolveToken(c)
	if !ok {
		return
	}
	if !scanner.IsInsideSource(absPath) {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}

	// Verify the file exists and is not a directory before doing anything.
	info, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.AbortWithStatus(http.StatusNotFound)
		} else {
			c.AbortWithStatus(http.StatusInternalServerError)
		}
		return
	}
	if info.IsDir() {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}

	// Check for pre-transcoded proxy file first — if it exists, serve it
	// with full Range support (identical UX to native H.264).
	if h.proxyManager != nil && h.proxyManager.HasProxy(absPath) {
		proxyPath := h.proxyManager.ProxyPath(absPath)
		pf, err := os.Open(proxyPath)
		if err == nil {
			defer pf.Close()
			pStat, _ := pf.Stat()
			c.Header("Content-Type", "video/mp4")
			c.Header("Accept-Ranges", "bytes")
			c.Header("Cache-Control", "no-store")
			http.ServeContent(c.Writer, c.Request, pStat.Name(), pStat.ModTime(), pf)
			return
		}
	}

	if c.Query("transcode") == "1" {
		h.streamTranscoded(c, absPath)
		return
	}

	// Direct streaming — fast path for H.264/AAC content.
	f, err := os.Open(absPath)
	if err != nil {
		c.AbortWithStatus(http.StatusInternalServerError)
		return
	}
	defer f.Close()
	c.Header("Content-Type", mimeTypeForExt(absPath))
	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "no-store")
	http.ServeContent(c.Writer, c.Request, info.Name(), info.ModTime(), f)
}

// streamTranscoded spawns ffmpeg to real-time transcode the source file
// from HEVC (or any codec) to H.264/AAC fragmented MP4, writing directly
// to the HTTP response. This lets the browser's <video> consume HEVC
// recordings without any pre-processing step.
//
// Lifecycle: ffmpeg is killed when the client disconnects (context cancel)
// or when ffmpeg itself exits (end of file). There is no persistent
// subprocess — each request spawns its own.
func (h *Handler) streamTranscoded(c *gin.Context, absPath string) {
	ffmpegBin, err := exec.LookPath("ffmpeg")
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{
			"error": "ffmpeg not found on server — install it or pre-convert to H.264",
		})
		return
	}

	seekSec := c.DefaultQuery("seek", "0")
	if _, err := strconv.ParseFloat(seekSec, 64); err != nil {
		seekSec = "0"
	}

	// Use the request context so ffmpeg is killed when the client
	// disconnects (browser navigates away, component unmounts, etc.).
	ctx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()

	// Try hardware-accelerated H.264 encoding first (Apple VideoToolbox on
	// macOS, NVENC on Linux/Windows). Falls back to libx264 ultrafast if the
	// HW encoder is not available.
	videoCodecArgs := hwEncodeArgs()

	args := []string{
		"-hide_banner", "-loglevel", "error",
		// Input seek (fast, keyframe-based).
		"-ss", seekSec,
		"-i", absPath,
		// Scale to 720p to keep browser decode + bandwidth manageable.
		"-vf", "scale=-2:720",
	}
	args = append(args, videoCodecArgs...)
	args = append(args,
		"-c:a", "aac", "-b:a", "128k",
		// Fragmented MP4 so the browser can start playing immediately.
		"-f", "mp4",
		"-movflags", "frag_keyframe+empty_moov+default_base_moof",
		"pipe:1",
	)

	cmd := exec.CommandContext(ctx, ffmpegBin, args...)
	cmd.Stderr = nil // suppress ffmpeg stderr noise

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("pipe: %v", err)})
		return
	}

	if err := cmd.Start(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("ffmpeg start: %v", err)})
		return
	}

	c.Header("Content-Type", "video/mp4")
	c.Header("Cache-Control", "no-store")
	// No Content-Length — chunked transfer.
	c.Status(http.StatusOK)

	// Stream ffmpeg stdout → HTTP response. When the client disconnects,
	// ctx is cancelled, cmd is killed, stdout returns EOF, and we exit.
	buf := make([]byte, 64*1024)
	for {
		n, readErr := stdout.Read(buf)
		if n > 0 {
			if _, writeErr := c.Writer.Write(buf[:n]); writeErr != nil {
				break
			}
			c.Writer.Flush()
		}
		if readErr != nil {
			break
		}
	}

	if waitErr := cmd.Wait(); waitErr != nil {
		// Context cancellation (client disconnect) is expected, not an error.
		if ctx.Err() == nil {
			log.Printf("video: ffmpeg transcode %s: %v", filepath.Base(absPath), waitErr)
		}
	}
}

// resolveToken decodes the URL-safe base64 token from :token param into
// a cleaned absolute path. Returns false and writes an HTTP error if
// the token is invalid.
func resolveToken(c *gin.Context) (string, bool) {
	token := c.Param("token")
	token = strings.TrimPrefix(token, "/")
	if token == "" {
		c.AbortWithStatus(http.StatusBadRequest)
		return "", false
	}
	rawBytes, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return "", false
	}
	absPath := string(rawBytes)
	if absPath == "" || !filepath.IsAbs(absPath) {
		c.AbortWithStatus(http.StatusBadRequest)
		return "", false
	}
	return filepath.Clean(absPath), true
}

// EncodeStreamToken returns the URL-safe base64 token for a given
// absolute path.
func EncodeStreamToken(absPath string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(absPath))
}

// hwEncodeArgs returns the ffmpeg video codec arguments, preferring hardware
// encoders when available.  The detection runs once at startup and is cached.
//
// Priority: h264_videotoolbox (macOS) > h264_nvenc (NVIDIA) > libx264 ultrafast.
// Hardware encoders are ~10x faster and offload the CPU entirely, which is
// critical for real-time transcode during high-speed playback (16x–64x).
func hwEncodeArgs() []string {
	hwOnce.Do(func() {
		ffmpegBin, err := exec.LookPath("ffmpeg")
		if err != nil {
			hwArgs = swFallbackArgs
			return
		}
		for _, candidate := range []struct {
			encoder string
			args    []string
		}{
			{"h264_videotoolbox", []string{"-c:v", "h264_videotoolbox", "-b:v", "5M", "-realtime", "1"}},
			{"h264_nvenc", []string{"-c:v", "h264_nvenc", "-preset", "p1", "-b:v", "5M"}},
		} {
			cmd := exec.Command(ffmpegBin,
				"-hide_banner", "-loglevel", "error",
				"-f", "lavfi", "-i", "color=black:size=64x64:rate=1",
				"-frames:v", "1",
				"-c:v", candidate.encoder,
				"-f", "null", "-",
			)
			if cmd.Run() == nil {
				log.Printf("video: using hardware encoder %s", candidate.encoder)
				hwArgs = candidate.args
				return
			}
		}
		log.Printf("video: no hardware encoder found, using libx264 ultrafast")
		hwArgs = swFallbackArgs
	})
	return hwArgs
}

var (
	hwOnce         sync.Once
	hwArgs         []string
	swFallbackArgs = []string{"-c:v", "libx264", "-preset", "ultrafast", "-crf", "28"}
)

// mimeTypeForExt returns the Content-Type to advertise for a given path.
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
