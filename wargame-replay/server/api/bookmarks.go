package api

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Bookmark represents a user-created bookmark in the replay timeline.
type Bookmark struct {
	Ts    string   `json:"ts"`
	Title string   `json:"title"`
	Tags  []string `json:"tags"`
}

// bookmarkFilePath returns the sidecar .bookmarks.json path for a game.
func (h *Handler) bookmarkFilePath(gameID string) (string, error) {
	for _, g := range h.games {
		if g.ID == gameID {
			return g.FilePath + ".bookmarks.json", nil
		}
	}
	return "", nil
}

// loadBookmarks reads bookmarks from the sidecar file. Returns empty slice if not found.
func loadBookmarks(path string) ([]Bookmark, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []Bookmark{}, nil
	}
	if err != nil {
		return nil, err
	}
	var bms []Bookmark
	if err := json.Unmarshal(data, &bms); err != nil {
		return nil, err
	}
	return bms, nil
}

// saveBookmarks writes bookmarks to the sidecar file.
func saveBookmarks(path string, bms []Bookmark) error {
	data, err := json.MarshalIndent(bms, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// ListBookmarks handles GET /api/games/:id/bookmarks
func (h *Handler) ListBookmarks(c *gin.Context) {
	path, err := h.bookmarkFilePath(c.Param("id"))
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}
	bms, err := loadBookmarks(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, bms)
}

// CreateBookmark handles POST /api/games/:id/bookmarks
func (h *Handler) CreateBookmark(c *gin.Context) {
	path, err := h.bookmarkFilePath(c.Param("id"))
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	var bm Bookmark
	if err := c.ShouldBindJSON(&bm); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if bm.Tags == nil {
		bm.Tags = []string{}
	}

	bms, err := loadBookmarks(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	bms = append(bms, bm)

	if err := saveBookmarks(path, bms); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, bm)
}

// DeleteBookmark handles DELETE /api/games/:id/bookmarks/:idx
func (h *Handler) DeleteBookmark(c *gin.Context) {
	path, err := h.bookmarkFilePath(c.Param("id"))
	if err != nil || path == "" {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	idx, err := strconv.Atoi(c.Param("idx"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid index"})
		return
	}

	bms, err := loadBookmarks(path)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if idx < 0 || idx >= len(bms) {
		c.JSON(http.StatusNotFound, gin.H{"error": "bookmark index out of range"})
		return
	}

	bms = append(bms[:idx], bms[idx+1:]...)

	if err := saveBookmarks(path, bms); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"deleted": idx})
}

// SuggestBookmarks handles GET /api/games/:id/bookmarks/suggest
// Returns auto-suggested bookmarks from hotspot score spikes (90th percentile threshold).
func (h *Handler) SuggestBookmarks(c *gin.Context) {
	svc, err := h.GetService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	frames := svc.Hotspots()
	if len(frames) == 0 {
		c.JSON(http.StatusOK, []Bookmark{})
		return
	}

	// Collect all MaxScore values and sort to find the 90th percentile threshold.
	scores := make([]float64, len(frames))
	for i, f := range frames {
		scores[i] = float64(f.MaxScore)
	}
	sorted := make([]float64, len(scores))
	copy(sorted, scores)
	sort.Float64s(sorted)

	p90idx := int(float64(len(sorted)) * 0.90)
	if p90idx >= len(sorted) {
		p90idx = len(sorted) - 1
	}
	threshold := sorted[p90idx]

	var suggestions []Bookmark
	for _, f := range frames {
		if float64(f.MaxScore) >= threshold {
			suggestions = append(suggestions, Bookmark{
				Ts:    f.Ts,
				Title: "High activity at " + f.Ts,
				Tags:  []string{"auto", "hotspot"},
			})
		}
	}

	// Deduplicate nearby timestamps (keep at most one per minute).
	suggestions = deduplicateSuggestions(suggestions)

	c.JSON(http.StatusOK, suggestions)
}

// deduplicateSuggestions keeps only the first suggestion within any 60-second window
// to avoid returning many bookmarks for the same activity burst.
func deduplicateSuggestions(bms []Bookmark) []Bookmark {
	if len(bms) == 0 {
		return bms
	}
	// Timestamps are "YYYY-MM-DD HH:MM:SS" — lexicographically sortable.
	sort.Slice(bms, func(i, j int) bool { return bms[i].Ts < bms[j].Ts })

	result := []Bookmark{bms[0]}
	for _, bm := range bms[1:] {
		last := result[len(result)-1]
		// Compare only up to the minute portion (first 15 chars: "YYYY-MM-DD HH:M").
		if len(bm.Ts) >= 15 && len(last.Ts) >= 15 && bm.Ts[:15] == last.Ts[:15] {
			continue
		}
		result = append(result, bm)
	}
	return result
}

// bookmarkSidecarDir returns the directory containing the .db file for a game.
// Exported for use in tests.
func bookmarkSidecarDir(dbPath string) string {
	return filepath.Dir(dbPath)
}
