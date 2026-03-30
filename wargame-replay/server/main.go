package main

import (
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"wargame-replay/server/api"
	"wargame-replay/server/ws"

	"github.com/gin-gonic/gin"
)

func serveStatic(r *gin.Engine) {
	distFS, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Printf("No embedded static files: %v", err)
		return
	}
	fileServer := http.FileServer(http.FS(distFS))
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		// Strip leading slash to get relative path for Open
		relPath := path
		if len(relPath) > 0 && relPath[0] == '/' {
			relPath = relPath[1:]
		}
		// Try to open the requested file
		f, err := distFS.Open(relPath)
		if err != nil || relPath == "" {
			// SPA fallback: serve index.html for unknown routes
			c.Request.URL.Path = "/"
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		f.Close()
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}

func main() {
	dir := flag.String("dir", ".", "Directory containing .db files")
	host := flag.String("host", "127.0.0.1", "Listen host")
	port := flag.Int("port", 8080, "Listen port")
	flag.Parse()

	handler, err := api.NewHandler(*dir)
	if err != nil {
		log.Fatalf("Failed to initialize handler: %v", err)
	}

	r := gin.Default()
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "dir": *dir})
	})
	r.GET("/api/games", handler.ListGames)
	r.GET("/api/games/:id/meta", handler.GetMeta)
	r.GET("/api/games/:id/frame/:ts", handler.GetFrame)
	r.GET("/api/games/:id/hotspots", handler.GetHotspots)
	r.GET("/api/games/:id/bookmarks", handler.ListBookmarks)
	r.POST("/api/games/:id/bookmarks", handler.CreateBookmark)
	r.DELETE("/api/games/:id/bookmarks/:idx", handler.DeleteBookmark)
	r.GET("/api/games/:id/bookmarks/suggest", handler.SuggestBookmarks)
	r.GET("/api/games/:id/clips", handler.ListClips)
	r.POST("/api/games/:id/clips", handler.CreateClip)
	r.PUT("/api/games/:id/clips/:idx", handler.UpdateClip)
	r.DELETE("/api/games/:id/clips/:idx", handler.DeleteClip)
	r.GET("/api/games/:id/clips/:idx/export", handler.ExportClip)
	r.GET("/ws/games/:id/stream", ws.HandleStream(handler.GetService))

	serveStatic(r)

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("Starting server on %s, scanning %s", addr, *dir)
	log.Fatal(r.Run(addr))
}
