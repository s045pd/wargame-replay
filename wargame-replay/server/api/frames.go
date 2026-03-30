package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *Handler) GetFrame(c *gin.Context) {
	svc, err := h.GetService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	ts := c.Param("ts")
	frame, err := svc.GetFrame(ts)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, frame)
}
