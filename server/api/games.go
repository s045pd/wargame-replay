package api

import (
	"fmt"
	"net/http"
	"sync"
	"wargame-replay/server/game"
	"wargame-replay/server/scanner"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	mu       sync.RWMutex
	games    []scanner.GameInfo
	services map[string]*game.Service // gameID → service
	dataDir  string
}

func NewHandler(dataDir string) (*Handler, error) {
	games, err := scanner.ScanDirectory(dataDir)
	if err != nil {
		return nil, err
	}
	return &Handler{
		games:    games,
		services: make(map[string]*game.Service),
		dataDir:  dataDir,
	}, nil
}

func (h *Handler) ListGames(c *gin.Context) {
	h.mu.RLock()
	games := h.games
	h.mu.RUnlock()
	if games == nil {
		c.JSON(http.StatusOK, []scanner.GameInfo{})
		return
	}
	c.JSON(http.StatusOK, games)
}

func (h *Handler) GetMeta(c *gin.Context) {
	svc, err := h.GetService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, svc.Meta())
}

// GetHotspots returns the full precomputed hotspot timeline for a game.
func (h *Handler) GetHotspots(c *gin.Context) {
	svc, err := h.GetService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, svc.HotspotEvents())
}

// GetKills returns all kill events for the entire game, pre-sorted by timestamp.
// The frontend uses this for an accurate kill leaderboard that survives seek/fast-forward.
func (h *Handler) GetKills(c *gin.Context) {
	svc, err := h.GetService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, svc.KillEvents())
}

func (h *Handler) GetService(gameID string) (*game.Service, error) {
	// Fast path: read lock
	h.mu.RLock()
	if svc, ok := h.services[gameID]; ok {
		h.mu.RUnlock()
		return svc, nil
	}
	h.mu.RUnlock()

	// Slow path: write lock, load game
	h.mu.Lock()
	defer h.mu.Unlock()

	// Double-check after acquiring write lock
	if svc, ok := h.services[gameID]; ok {
		return svc, nil
	}
	for _, g := range h.games {
		if g.ID == gameID {
			svc, err := game.LoadGame(g.FilePath)
			if err != nil {
				return nil, err
			}
			h.services[gameID] = svc
			return svc, nil
		}
	}
	return nil, fmt.Errorf("game %s not found", gameID)
}

// AddGame registers a new game at runtime (used by file upload).
func (h *Handler) AddGame(info scanner.GameInfo) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.games = append(h.games, info)
}

// DataDir returns the data directory path.
func (h *Handler) DataDir() string {
	return h.dataDir
}
