package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// GetUnitClasses returns the current unit class config for a game.
func (h *Handler) GetUnitClasses(c *gin.Context) {
	svc, err := h.GetService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, svc.UnitClasses().GetAll())
}

// SetUnitClasses replaces the unit class config for a game.
// Body: {"0": "rifle", "506": "sniper", ...}
func (h *Handler) SetUnitClasses(c *gin.Context) {
	svc, err := h.GetService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	var classes map[string]string
	if err := c.ShouldBindJSON(&classes); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cfg := svc.UnitClasses()
	cfg.SetBatch(classes)
	if err := cfg.Save(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Invalidate cached frames so new class labels take effect immediately
	svc.ClearFrameCache()
	c.JSON(http.StatusOK, cfg.GetAll())
}
