package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"wargame-replay/server/video"

	"github.com/gin-gonic/gin"
)

// GetVideoStatus handles GET /api/videos/status.
//
// Always returns 200. The frontend uses `ready` (scanner object exists) to
// decide whether to show any video UI at all, and `enabled` (at least one
// source registered) to decide whether to show the "add source" empty
// state or the normal groups/candidates UI.
func (h *Handler) GetVideoStatus(c *gin.Context) {
	if h.videoScanner == nil {
		c.JSON(http.StatusOK, gin.H{
			"ready":        false,
			"enabled":      false,
			"sources":      []string{},
			"segmentCount": 0,
			"scanning":     false,
		})
		return
	}
	status := h.videoScanner.Status()
	c.JSON(http.StatusOK, gin.H{
		"ready":        true,
		"enabled":      status.Enabled,
		"sources":      status.Sources,
		"segmentCount": status.SegmentCount,
		"lastScanAt":   status.LastScanAt,
		"scanning":     status.Scanning,
	})
}

// PostVideoRescan handles POST /api/videos/rescan.
func (h *Handler) PostVideoRescan(c *gin.Context) {
	if h.videoScanner == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video feature not initialised"})
		return
	}
	if err := h.videoScanner.Scan(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.GetVideoStatus(c)
}

// sourceInfo is one row in the sources API response.
type sourceInfo struct {
	Path         string `json:"path"`
	SegmentCount int    `json:"segmentCount"`
	Exists       bool   `json:"exists"`
}

// GetVideoSources handles GET /api/videos/sources.
func (h *Handler) GetVideoSources(c *gin.Context) {
	if h.videoScanner == nil {
		c.JSON(http.StatusOK, gin.H{"sources": []sourceInfo{}})
		return
	}
	sources := h.videoScanner.Sources()
	entries := h.videoScanner.Index().Entries()

	countBySource := make(map[string]int, len(sources))
	for _, e := range entries {
		for _, src := range sources {
			if strings.HasPrefix(e.AbsPath, src+string(filepath.Separator)) || e.AbsPath == src {
				countBySource[src]++
				break
			}
		}
	}
	out := make([]sourceInfo, len(sources))
	for i, src := range sources {
		info, err := os.Stat(src)
		out[i] = sourceInfo{
			Path:         src,
			SegmentCount: countBySource[src],
			Exists:       err == nil && info.IsDir(),
		}
	}
	c.JSON(http.StatusOK, gin.H{"sources": out})
}

// addSourcePayload is the request body for POST /api/videos/sources.
type addSourcePayload struct {
	Path string `json:"path"`
}

// PostVideoSource handles POST /api/videos/sources.
func (h *Handler) PostVideoSource(c *gin.Context) {
	if h.videoScanner == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video feature not initialised"})
		return
	}
	var body addSourcePayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path is required"})
		return
	}
	abs, err := h.videoScanner.AddSource(body.Path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"path": abs})
}

// DeleteVideoSource handles DELETE /api/videos/sources.
// Path is passed as a query parameter because POSIX absolute paths
// contain slashes and do not fit cleanly in a URL param.
func (h *Handler) DeleteVideoSource(c *gin.Context) {
	if h.videoScanner == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video feature not initialised"})
		return
	}
	path := c.Query("path")
	if path == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "path query parameter is required"})
		return
	}
	if err := h.videoScanner.RemoveSource(path); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": path})
}

// browseEntry is one row in the directory-browser response.
type browseEntry struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	IsDir      bool   `json:"isDir"`
	VideoCount int    `json:"videoCount,omitempty"`
}

// GetBrowseDirectory handles GET /api/videos/browse?path=...
//
// Returns the list of subdirectories at the given path so the UI can
// drive a native-feeling file picker without pulling in a separate
// file-dialog mechanism. Defaults to $HOME when no path is provided.
// Safety is intentionally minimal: this is a local desktop tool and the
// process already has the same filesystem privileges as the user.
func (h *Handler) GetBrowseDirectory(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		if home, err := os.UserHomeDir(); err == nil {
			path = home
		} else {
			path = "/"
		}
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	abs = filepath.Clean(abs)

	info, err := os.Stat(abs)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not a directory"})
		return
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Soft total budget for optional per-subfolder probes (symlink
	// resolution + mp4 count). macOS roots like "/" contain entries
	// that take seconds each to stat (network mounts, SIP, Time
	// Machine, /System/Volumes, etc.), so once the budget is used up
	// we fall back to "directly-reported directories only" and no
	// counts — still useful, but instant.
	probeDeadline := time.Now().Add(600 * time.Millisecond)

	subDirs := make([]browseEntry, 0, len(entries))
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		child := filepath.Join(abs, name)

		isDir := e.IsDir()
		if !isDir {
			// symlink-to-dir fallback: try only if we still have budget.
			if time.Now().After(probeDeadline) {
				continue
			}
			info, err := os.Stat(child)
			if err != nil || !info.IsDir() {
				continue
			}
			isDir = true
		}

		count := 0
		if time.Now().Before(probeDeadline) {
			count = quickCountVideos(child)
		}
		subDirs = append(subDirs, browseEntry{
			Name:       name,
			Path:       child,
			IsDir:      isDir,
			VideoCount: count,
		})
	}
	// Alphabetical for predictability across platforms.
	sort.Slice(subDirs, func(i, j int) bool {
		return strings.ToLower(subDirs[i].Name) < strings.ToLower(subDirs[j].Name)
	})

	parent := filepath.Dir(abs)
	if parent == abs {
		parent = ""
	}

	c.JSON(http.StatusOK, gin.H{
		"path":    abs,
		"parent":  parent,
		"entries": subDirs,
	})
}

// quickCountVideos returns a shallow count of recognised video files in
// dir (non-recursive). Used as a hint in the browser so users see which
// folders have content without having to drill in.
func quickCountVideos(dir string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := strings.ToLower(e.Name())
		if strings.HasSuffix(name, ".mp4") ||
			strings.HasSuffix(name, ".m4v") ||
			strings.HasSuffix(name, ".mov") {
			count++
		}
	}
	return count
}

// GetVideoCandidates handles GET /api/games/:id/videos/candidates.
func (h *Handler) GetVideoCandidates(c *gin.Context) {
	if h.videoScanner == nil {
		c.JSON(http.StatusOK, gin.H{"candidates": []video.CandidateGroup{}})
		return
	}
	info, ok := h.findGameInfo(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	start, err := parseLocalGameTs(info.StartTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("parse start time: %v", err)})
		return
	}
	end, err := parseLocalGameTs(info.EndTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("parse end time: %v", err)})
		return
	}
	const pad = 5 * time.Minute
	startUTC := start.UTC().Add(-pad)
	endUTC := end.UTC().Add(pad)

	entries := h.videoScanner.Index().FindOverlapping(startUTC, endUTC)
	groups := video.AutoGroup(entries)
	if groups == nil {
		groups = []video.CandidateGroup{}
	}
	c.JSON(http.StatusOK, gin.H{"candidates": groups})
}

// GetVideoLibrary handles GET /api/videos/library.
func (h *Handler) GetVideoLibrary(c *gin.Context) {
	if h.videoScanner == nil {
		c.JSON(http.StatusOK, gin.H{"segments": []video.VideoSegment{}})
		return
	}
	entries := h.videoScanner.Index().Entries()
	segments := make([]video.VideoSegment, len(entries))
	for i, e := range entries {
		segments[i] = e.ToSegment()
	}
	c.JSON(http.StatusOK, gin.H{"segments": segments})
}

// GetVideoGroups handles GET /api/games/:id/videos.
func (h *Handler) GetVideoGroups(c *gin.Context) {
	info, ok := h.findGameInfo(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	groups, err := video.LoadSidecar(info.FilePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if groups == nil {
		groups = []video.VideoGroup{}
	}
	if h.videoScanner != nil {
		h.videoScanner.Index().AnnotateStale(groups)
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

// createVideoGroupPayload is the request body for POST /api/games/:id/videos.
// The segmentPaths field carries absolute paths as exposed by the scanner;
// "segmentRelPaths" is kept as a legacy alias for older clients that still
// send relative paths inside the single-root videodir world.
type createVideoGroupPayload struct {
	UnitID          int      `json:"unitId"`
	CameraLabel     string   `json:"cameraLabel"`
	OffsetMs        int64    `json:"offsetMs"`
	SegmentPaths    []string `json:"segmentPaths"`
	SegmentRelPaths []string `json:"segmentRelPaths"`
	Notes           string   `json:"notes,omitempty"`
}

func (p *createVideoGroupPayload) paths() []string {
	if len(p.SegmentPaths) > 0 {
		return p.SegmentPaths
	}
	return p.SegmentRelPaths
}

// PostVideoGroup handles POST /api/games/:id/videos.
func (h *Handler) PostVideoGroup(c *gin.Context) {
	info, ok := h.findGameInfo(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	if h.videoScanner == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video feature not initialised"})
		return
	}

	var body createVideoGroupPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	paths := body.paths()
	if len(paths) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one segment is required"})
		return
	}
	if body.CameraLabel == "" {
		body.CameraLabel = "Camera"
	}

	segments := make([]video.VideoSegment, 0, len(paths))
	for _, p := range paths {
		entry, ok := h.videoScanner.Index().Lookup(p)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("segment not in index: %s", p)})
			return
		}
		segments = append(segments, entry.ToSegment())
	}

	g := video.VideoGroup{
		UnitID:      body.UnitID,
		CameraLabel: body.CameraLabel,
		OffsetMs:    body.OffsetMs,
		Notes:       body.Notes,
		Segments:    segments,
	}
	saved, err := video.AddGroup(info.FilePath, info.ID, g)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, saved)
}

// quickAddPayload is the request body for POST /api/games/:id/videos/quick-add.
// One call: add the directory as a source if needed, scan, auto-group the
// matching segments, auto-align to the game start, and persist the new
// VideoGroup. The UX target is: user picks a unit and a directory, clicks
// confirm, and the group appears.
type quickAddPayload struct {
	UnitID      int    `json:"unitId"`
	CameraLabel string `json:"cameraLabel"`
	Directory   string `json:"directory"`
}

// PostQuickAdd handles POST /api/games/:id/videos/quick-add.
func (h *Handler) PostQuickAdd(c *gin.Context) {
	info, ok := h.findGameInfo(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	if h.videoScanner == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video feature not initialised"})
		return
	}
	var body quickAddPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Directory == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "directory is required"})
		return
	}
	if body.CameraLabel == "" {
		body.CameraLabel = "Camera"
	}

	abs, err := h.videoScanner.AddSource(body.Directory)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Window of segments whose time range overlaps this game, plus a
	// generous pad for recordings that started a few minutes early.
	startGame, err := parseLocalGameTs(info.StartTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	endGame, err := parseLocalGameTs(info.EndTime)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	const pad = 30 * time.Minute
	startUTC := startGame.UTC().Add(-pad)
	endUTC := endGame.UTC().Add(pad)

	// Only keep segments that physically live under the directory the
	// user just added, so the call is scoped to "this folder".
	all := h.videoScanner.Index().FindOverlapping(startUTC, endUTC)
	filtered := make([]video.IndexEntry, 0, len(all))
	for _, e := range all {
		if strings.HasPrefix(e.AbsPath, abs+string(filepath.Separator)) || e.AbsPath == abs {
			filtered = append(filtered, e)
		}
	}
	if len(filtered) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "no matching video in selected directory",
			"hint":  "check that mp4 creation_time overlaps game time range",
		})
		return
	}

	candidates := video.AutoGroup(filtered)
	if len(candidates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no candidate group"})
		return
	}
	// Pick the candidate with the longest total duration. A single
	// continuous multi-segment recording wins over a single short clip.
	best := candidates[0]
	for _, cand := range candidates[1:] {
		if cand.TotalDurationMs > best.TotalDurationMs {
			best = cand
		}
	}

	// Auto offset: gameStart (local) - firstSegment.StartTs (UTC).
	// Both are unix milliseconds, so the difference is offsetMs in the
	// same algebra used by the frontend VideoEngine.
	firstStart := best.Segments[0].StartTs
	offsetMs := startGame.UnixMilli() - firstStart.UnixMilli()

	g := video.VideoGroup{
		UnitID:      body.UnitID,
		CameraLabel: body.CameraLabel,
		OffsetMs:    offsetMs,
		Segments:    best.Segments,
	}
	saved, err := video.AddGroup(info.FilePath, info.ID, g)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"group":  saved,
		"source": abs,
	})
}

// updateVideoGroupPayload is the (partial) request body for PUT.
type updateVideoGroupPayload struct {
	UnitID          *int      `json:"unitId,omitempty"`
	CameraLabel     *string   `json:"cameraLabel,omitempty"`
	OffsetMs        *int64    `json:"offsetMs,omitempty"`
	Notes           *string   `json:"notes,omitempty"`
	SegmentPaths    *[]string `json:"segmentPaths,omitempty"`
	SegmentRelPaths *[]string `json:"segmentRelPaths,omitempty"`
}

func (p *updateVideoGroupPayload) paths() *[]string {
	if p.SegmentPaths != nil {
		return p.SegmentPaths
	}
	return p.SegmentRelPaths
}

// PutVideoGroup handles PUT /api/games/:id/videos/:groupId.
func (h *Handler) PutVideoGroup(c *gin.Context) {
	info, ok := h.findGameInfo(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	groupID := c.Param("groupId")

	var body updateVideoGroupPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var newSegments []video.VideoSegment
	if paths := body.paths(); paths != nil {
		if h.videoScanner == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "video feature not initialised"})
			return
		}
		for _, p := range *paths {
			entry, ok := h.videoScanner.Index().Lookup(p)
			if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("segment not in index: %s", p)})
				return
			}
			newSegments = append(newSegments, entry.ToSegment())
		}
	}

	err := video.UpdateGroup(info.FilePath, info.ID, groupID, func(g *video.VideoGroup) {
		if body.UnitID != nil {
			g.UnitID = *body.UnitID
		}
		if body.CameraLabel != nil {
			g.CameraLabel = *body.CameraLabel
		}
		if body.OffsetMs != nil {
			g.OffsetMs = *body.OffsetMs
		}
		if body.Notes != nil {
			g.Notes = *body.Notes
		}
		if body.paths() != nil {
			g.Segments = newSegments
		}
	})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	groups, err := video.LoadSidecar(info.FilePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if h.videoScanner != nil {
		h.videoScanner.Index().AnnotateStale(groups)
	}
	for _, g := range groups {
		if g.ID == groupID {
			c.JSON(http.StatusOK, g)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"id": groupID})
}

// DeleteVideoGroup handles DELETE /api/games/:id/videos/:groupId.
func (h *Handler) DeleteVideoGroup(c *gin.Context) {
	info, ok := h.findGameInfo(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	groupID := c.Param("groupId")
	if err := video.DeleteGroup(info.FilePath, info.ID, groupID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"deleted": groupID})
}

// parseLocalGameTs parses the "YYYY-MM-DD HH:MM:SS" format used in
// GameInfo start/end times, interpreting them in the local timezone.
func parseLocalGameTs(ts string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02 15:04:05", ts, time.Local)
}
