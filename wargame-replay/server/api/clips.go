package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Clip represents a user-created clip in the replay timeline.
type Clip struct {
	StartTs string   `json:"startTs"`
	EndTs   string   `json:"endTs"`
	Title   string   `json:"title"`
	Speed   float64  `json:"speed"`
	Tags    []string `json:"tags"`
}

// ClipExport is the full export payload for a clip.
type ClipExport struct {
	Clip       Clip          `json:"clip"`
	Timestamps []string      `json:"timestamps"`
	Frames     []interface{} `json:"frames,omitempty"`
}

// clipFilePath returns the sidecar .clips.json path for a game.
func (h *Handler) clipFilePath(gameID string) (string, error) {
	for _, g := range h.games {
		if g.ID == gameID {
			return g.FilePath + ".clips.json", nil
		}
	}
	return "", nil
}

// loadClips reads clips from the sidecar file. Returns empty slice if not found.
func loadClips(path string) ([]Clip, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []Clip{}, nil
	}
	if err != nil {
		return nil, err
	}
	var clips []Clip
	if err := json.Unmarshal(data, &clips); err != nil {
		return nil, err
	}
	return clips, nil
}

// saveClips writes clips to the sidecar file.
func saveClips(path string, clips []Clip) error {
	data, err := json.MarshalIndent(clips, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// ListClips handles GET /api/games/:id/clips
func (h *Handler) ListClips(c *gin.Context) {
	path, err := h.clipFilePath(c.Param("id"))
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	clips, err := loadClips(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, clips)
}

// CreateClip handles POST /api/games/:id/clips
func (h *Handler) CreateClip(c *gin.Context) {
	path, err := h.clipFilePath(c.Param("id"))
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	var clip Clip
	if err := c.ShouldBindJSON(&clip); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if clip.Tags == nil {
		clip.Tags = []string{}
	}
	if clip.Speed == 0 {
		clip.Speed = 1
	}

	clips, err := loadClips(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	clips = append(clips, clip)

	if err := saveClips(path, clips); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, clip)
}

// UpdateClip handles PUT /api/games/:id/clips/:idx
func (h *Handler) UpdateClip(c *gin.Context) {
	path, err := h.clipFilePath(c.Param("id"))
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	idx, err := strconv.Atoi(c.Param("idx"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid index"})
		return
	}

	var updated Clip
	if err := c.ShouldBindJSON(&updated); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if updated.Tags == nil {
		updated.Tags = []string{}
	}

	clips, err := loadClips(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if idx < 0 || idx >= len(clips) {
		c.JSON(http.StatusNotFound, gin.H{"error": "clip index out of range"})
		return
	}

	clips[idx] = updated

	if err := saveClips(path, clips); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, updated)
}

// DeleteClip handles DELETE /api/games/:id/clips/:idx
func (h *Handler) DeleteClip(c *gin.Context) {
	path, err := h.clipFilePath(c.Param("id"))
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	idx, err := strconv.Atoi(c.Param("idx"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid index"})
		return
	}

	clips, err := loadClips(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if idx < 0 || idx >= len(clips) {
		c.JSON(http.StatusNotFound, gin.H{"error": "clip index out of range"})
		return
	}

	clips = append(clips[:idx], clips[idx+1:]...)

	if err := saveClips(path, clips); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": idx})
}

// ExportClip handles GET /api/games/:id/clips/:idx/export
// Query param: ?full=true includes full unit position data for each frame.
func (h *Handler) ExportClip(c *gin.Context) {
	gameID := c.Param("id")
	path, err := h.clipFilePath(gameID)
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	idx, err := strconv.Atoi(c.Param("idx"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid index"})
		return
	}

	clips, err := loadClips(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if idx < 0 || idx >= len(clips) {
		c.JSON(http.StatusNotFound, gin.H{"error": "clip index out of range"})
		return
	}

	clip := clips[idx]
	fullData := c.Query("full") == "true"

	// Load service for frame/time index queries.
	svc, err := h.GetService(gameID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	tidx := svc.TimeIndex()
	startIdx := tidx.IndexOf(clip.StartTs)
	endIdx := tidx.IndexOf(clip.EndTs)

	// Collect all timestamps in the clip range.
	var timestamps []string
	for i := startIdx; i <= endIdx; i++ {
		ts, ok := tidx.TimestampAt(i)
		if !ok {
			break
		}
		if ts > clip.EndTs {
			break
		}
		timestamps = append(timestamps, ts)
	}

	export := ClipExport{
		Clip:       clip,
		Timestamps: timestamps,
	}

	// P1: full position data per frame.
	if fullData {
		export.Frames = make([]interface{}, 0, len(timestamps))
		for _, ts := range timestamps {
			frame, err := svc.GetFrame(ts)
			if err != nil {
				continue
			}
			export.Frames = append(export.Frames, frame)
		}
	}

	c.JSON(http.StatusOK, export)
}
