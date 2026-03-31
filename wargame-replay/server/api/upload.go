package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"wargame-replay/server/scanner"

	"github.com/gin-gonic/gin"
)

// UploadResult represents the result of uploading a single file.
type UploadResult struct {
	Filename string           `json:"filename"`
	Status   string           `json:"status"` // "ok" or "error"
	Message  string           `json:"message,omitempty"`
	Game     *scanner.GameInfo `json:"game,omitempty"`
}

// UploadGame handles POST /api/upload
// Accepts multipart file upload of one or more .db and .txt files.
// .db files must match the scanner regex pattern.
// .txt files are placed alongside their matching .db file as sidecar metadata.
func (h *Handler) UploadGame(c *gin.Context) {
	if err := c.Request.ParseMultipartForm(256 << 20); err != nil { // 256 MB max
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to parse multipart form"})
		return
	}

	// Categorize uploaded files by extension
	type fileEntry struct {
		filename string
		field    string
		idx      int
	}
	var dbFiles []fileEntry
	var txtFiles []fileEntry
	var otherFiles []fileEntry

	for field, entries := range c.Request.MultipartForm.File {
		for i, header := range entries {
			ext := strings.ToLower(filepath.Ext(header.Filename))
			entry := fileEntry{filename: header.Filename, field: field, idx: i}
			switch ext {
			case ".db":
				dbFiles = append(dbFiles, entry)
			case ".txt":
				txtFiles = append(txtFiles, entry)
			default:
				otherFiles = append(otherFiles, entry)
			}
		}
	}

	// If no files found, try legacy single-file field "file"
	if len(dbFiles) == 0 && len(txtFiles) == 0 {
		file, header, err := c.Request.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no files in request"})
			return
		}
		defer file.Close()

		// Legacy single-file upload path
		result := h.processSingleDB(header.Filename, file)
		if result.Status == "error" {
			c.JSON(http.StatusBadRequest, result)
		} else {
			c.JSON(http.StatusCreated, result.Game)
		}
		return
	}

	var results []UploadResult

	// Reject unsupported extensions
	for _, f := range otherFiles {
		results = append(results, UploadResult{
			Filename: f.filename,
			Status:   "error",
			Message:  "unsupported file type (only .db and .txt accepted)",
		})
	}

	// Phase 1: Process .db files
	savedDBPaths := make(map[string]string) // baseName → destPath (for .txt pairing)
	for _, entry := range dbFiles {
		headers := c.Request.MultipartForm.File[entry.field]
		header := headers[entry.idx]
		file, err := header.Open()
		if err != nil {
			results = append(results, UploadResult{
				Filename: entry.filename,
				Status:   "error",
				Message:  fmt.Sprintf("cannot read file: %v", err),
			})
			continue
		}

		result := h.processSingleDB(entry.filename, file)
		file.Close()
		results = append(results, result)

		if result.Status == "ok" {
			baseName := strings.TrimSuffix(entry.filename, ".db")
			savedDBPaths[baseName] = filepath.Join(h.dataDir, entry.filename)
		}
	}

	// Phase 2: Process .txt files — pair with corresponding .db
	for _, entry := range txtFiles {
		headers := c.Request.MultipartForm.File[entry.field]
		header := headers[entry.idx]

		baseName := strings.TrimSuffix(entry.filename, ".txt")

		// Find matching .db path: either just uploaded or already on disk
		var dbPath string
		if p, ok := savedDBPaths[baseName]; ok {
			dbPath = p
		} else {
			// Check if the .db file already exists on disk
			candidate := filepath.Join(h.dataDir, baseName+".db")
			if _, err := os.Stat(candidate); err == nil {
				dbPath = candidate
			}
		}

		if dbPath == "" {
			results = append(results, UploadResult{
				Filename: entry.filename,
				Status:   "error",
				Message:  fmt.Sprintf("no matching .db file found for %s", entry.filename),
			})
			continue
		}

		// Save .txt alongside the .db
		txtPath := strings.TrimSuffix(dbPath, ".db") + ".txt"
		file, err := header.Open()
		if err != nil {
			results = append(results, UploadResult{
				Filename: entry.filename,
				Status:   "error",
				Message:  fmt.Sprintf("cannot read file: %v", err),
			})
			continue
		}

		tmpPath := txtPath + ".uploading"
		out, err := os.Create(tmpPath)
		if err != nil {
			file.Close()
			results = append(results, UploadResult{
				Filename: entry.filename,
				Status:   "error",
				Message:  fmt.Sprintf("cannot create file: %v", err),
			})
			continue
		}

		_, err = io.Copy(out, file)
		out.Close()
		file.Close()
		if err != nil {
			os.Remove(tmpPath)
			results = append(results, UploadResult{
				Filename: entry.filename,
				Status:   "error",
				Message:  fmt.Sprintf("write failed: %v", err),
			})
			continue
		}

		if err := os.Rename(tmpPath, txtPath); err != nil {
			os.Remove(tmpPath)
			results = append(results, UploadResult{
				Filename: entry.filename,
				Status:   "error",
				Message:  fmt.Sprintf("rename failed: %v", err),
			})
			continue
		}

		results = append(results, UploadResult{
			Filename: entry.filename,
			Status:   "ok",
			Message:  fmt.Sprintf("paired with %s.db", baseName),
		})
	}

	c.JSON(http.StatusOK, gin.H{"results": results})
}

// processSingleDB validates, saves, and registers a single .db file.
func (h *Handler) processSingleDB(filename string, file io.Reader) UploadResult {
	info, err := scanner.ParseFilename(filename)
	if err != nil {
		return UploadResult{
			Filename: filename,
			Status:   "error",
			Message:  fmt.Sprintf("invalid filename: %v (expected {session}_{YYYY-MM-DD-HH-MM-SS}_{YYYY-MM-DD-HH-MM-SS}.db)", err),
		}
	}

	destPath := filepath.Join(h.dataDir, filename)

	if _, err := os.Stat(destPath); err == nil {
		return UploadResult{
			Filename: filename,
			Status:   "error",
			Message:  "file already exists",
		}
	}

	tmpPath := destPath + ".uploading"
	out, err := os.Create(tmpPath)
	if err != nil {
		return UploadResult{
			Filename: filename,
			Status:   "error",
			Message:  fmt.Sprintf("cannot create file: %v", err),
		}
	}

	written, err := io.Copy(out, file)
	out.Close()
	if err != nil {
		os.Remove(tmpPath)
		return UploadResult{
			Filename: filename,
			Status:   "error",
			Message:  fmt.Sprintf("write failed: %v", err),
		}
	}

	if err := os.Rename(tmpPath, destPath); err != nil {
		os.Remove(tmpPath)
		return UploadResult{
			Filename: filename,
			Status:   "error",
			Message:  fmt.Sprintf("rename failed: %v", err),
		}
	}

	playerCount, _ := scanner.ReadPlayerCount(destPath)
	info.PlayerCount = playerCount
	info.FilePath = destPath

	// Check for ID collision
	h.mu.RLock()
	for _, g := range h.games {
		if g.ID == info.ID {
			info.ID = fmt.Sprintf("%s-%d", info.ID, len(h.games))
			break
		}
	}
	h.mu.RUnlock()

	h.AddGame(*info)

	fmt.Printf("Uploaded game: %s (%s, %d bytes)\n", filename, info.ID, written)

	return UploadResult{
		Filename: filename,
		Status:   "ok",
		Game:     info,
	}
}

// DeleteGame handles DELETE /api/games/:id
// Removes the game from the live list and optionally deletes the file.
func (h *Handler) DeleteGame(c *gin.Context) {
	gameID := c.Param("id")

	h.mu.Lock()
	defer h.mu.Unlock()

	idx := -1
	for i, g := range h.games {
		if g.ID == gameID {
			idx = i
			break
		}
	}

	if idx < 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "game not found"})
		return
	}

	game := h.games[idx]

	// Close loaded service if any
	if svc, ok := h.services[gameID]; ok {
		svc.Close()
		delete(h.services, gameID)
	}

	// Remove from game list
	h.games = append(h.games[:idx], h.games[idx+1:]...)

	// Delete the .db file and sidecar files
	os.Remove(game.FilePath)
	os.Remove(game.FilePath + ".hotspots.cache")
	os.Remove(game.FilePath + ".clips.json")
	os.Remove(game.FilePath + ".bookmarks.json")
	os.Remove(game.FilePath + ".unitclasses.json")
	// Also remove .txt sidecar
	os.Remove(strings.TrimSuffix(game.FilePath, ".db") + ".txt")

	c.JSON(http.StatusOK, gin.H{"deleted": gameID, "filename": game.Filename})
}
