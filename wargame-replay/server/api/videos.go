package api

import (
	"fmt"
	"net/http"
	"time"
	"wargame-replay/server/video"

	"github.com/gin-gonic/gin"
)

// GetVideoStatus handles GET /api/videos/status.
//
// Always returns 200 with { enabled, rootDir, segmentCount, lastScanAt, scanning }.
// When no scanner is configured the payload has enabled=false and empty fields,
// which the frontend uses to hide the video UI.
func (h *Handler) GetVideoStatus(c *gin.Context) {
	if h.videoScanner == nil || !h.videoScanner.Enabled() {
		c.JSON(http.StatusOK, video.Status{Enabled: false})
		return
	}
	c.JSON(http.StatusOK, h.videoScanner.Status())
}

// GetVideoLibrary handles GET /api/videos/library.
// Returns a flat list of all indexed segments, used by the RelinkDialog
// so a user can pick a replacement file when a sidecar reference goes stale.
func (h *Handler) GetVideoLibrary(c *gin.Context) {
	if h.videoScanner == nil || !h.videoScanner.Enabled() {
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

// PostVideoRescan handles POST /api/videos/rescan.  It triggers a synchronous
// scan and returns the new status.
func (h *Handler) PostVideoRescan(c *gin.Context) {
	if h.videoScanner == nil || !h.videoScanner.Enabled() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video feature disabled"})
		return
	}
	if err := h.videoScanner.Scan(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, h.videoScanner.Status())
}

// GetVideoCandidates handles GET /api/games/:id/videos/candidates.
// Returns the auto-grouped candidate list for videos whose time range overlaps
// the game's time range.
func (h *Handler) GetVideoCandidates(c *gin.Context) {
	if h.videoScanner == nil || !h.videoScanner.Enabled() {
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
	// mp4 creation_time is UTC but game timestamps are local. Convert both
	// to UTC before asking the index.  We also pad the window slightly so
	// segments that start a few seconds early (pre-game warmup) still show up.
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
	// Annotate stale segments so the UI can surface broken links without
	// requiring the sidecar file itself to change.
	if h.videoScanner != nil && h.videoScanner.Enabled() {
		h.videoScanner.Index().AnnotateStale(groups)
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

// createVideoGroupPayload is the request body for POST /api/games/:id/videos.
type createVideoGroupPayload struct {
	UnitID          int      `json:"unitId"`
	CameraLabel     string   `json:"cameraLabel"`
	OffsetMs        int64    `json:"offsetMs"`
	SegmentRelPaths []string `json:"segmentRelPaths"`
	Notes           string   `json:"notes,omitempty"`
}

// PostVideoGroup handles POST /api/games/:id/videos.
func (h *Handler) PostVideoGroup(c *gin.Context) {
	info, ok := h.findGameInfo(c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	if h.videoScanner == nil || !h.videoScanner.Enabled() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "video feature disabled"})
		return
	}

	var body createVideoGroupPayload
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(body.SegmentRelPaths) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "at least one segment is required"})
		return
	}
	if body.CameraLabel == "" {
		body.CameraLabel = "Camera"
	}

	segments := make([]video.VideoSegment, 0, len(body.SegmentRelPaths))
	for _, rel := range body.SegmentRelPaths {
		entry, ok := h.videoScanner.Index().Lookup(rel)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("segment not in index: %s", rel)})
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

// updateVideoGroupPayload is the (partial) request body for PUT.
type updateVideoGroupPayload struct {
	UnitID          *int      `json:"unitId,omitempty"`
	CameraLabel     *string   `json:"cameraLabel,omitempty"`
	OffsetMs        *int64    `json:"offsetMs,omitempty"`
	Notes           *string   `json:"notes,omitempty"`
	SegmentRelPaths *[]string `json:"segmentRelPaths,omitempty"`
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

	// If segmentRelPaths is provided, resolve them up front so the sidecar
	// mutation runs on validated data.
	var newSegments []video.VideoSegment
	if body.SegmentRelPaths != nil {
		if h.videoScanner == nil || !h.videoScanner.Enabled() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "video feature disabled"})
			return
		}
		for _, rel := range *body.SegmentRelPaths {
			entry, ok := h.videoScanner.Index().Lookup(rel)
			if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("segment not in index: %s", rel)})
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
		if body.SegmentRelPaths != nil {
			g.Segments = newSegments
		}
	})
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Return the updated group so the frontend can replace its copy.
	groups, err := video.LoadSidecar(info.FilePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	h.videoScanner.Index().AnnotateStale(groups)
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

// parseLocalGameTs parses the "YYYY-MM-DD HH:MM:SS" format used in GameInfo
// start/end times (from scanner.formatTimestamp).  The game stores them in the
// local timezone without a TZ suffix, matching how SQLite records LogTime.
func parseLocalGameTs(ts string) (time.Time, error) {
	return time.ParseInLocation("2006-01-02 15:04:05", ts, time.Local)
}
