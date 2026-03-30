package api

import (
	"fmt"
	"net/http"
	"wargame-replay/server/game"
	"wargame-replay/server/scanner"

	"github.com/gin-gonic/gin"
)

type Handler struct {
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
	c.JSON(http.StatusOK, h.games)
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
	c.JSON(http.StatusOK, svc.Hotspots())
}

func (h *Handler) GetService(gameID string) (*game.Service, error) {
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
