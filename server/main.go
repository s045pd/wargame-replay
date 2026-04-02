package main

import (
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"time"
	"wargame-replay/server/api"
	"wargame-replay/server/browser"
	"wargame-replay/server/ws"

	"github.com/gin-gonic/gin"
)

// version is set at build time via -ldflags.
var version = "dev"

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
			// No-cache for HTML so browser always gets latest version
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
			c.Header("Pragma", "no-cache")
			c.Header("Expires", "0")
			c.Request.URL.Path = "/"
			fileServer.ServeHTTP(c.Writer, c.Request)
			return
		}
		f.Close()
		// Cache hashed assets for 1 year, no-cache for everything else
		if len(relPath) > 7 && relPath[:7] == "assets/" {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		}
		fileServer.ServeHTTP(c.Writer, c.Request)
	})
}

func main() {
	dir := flag.String("dir", ".", "Directory containing .db files")
	host := flag.String("host", "127.0.0.1", "Listen host")
	port := flag.Int("port", 8080, "Listen port")
	openBrowser := flag.Bool("open", true, "auto-open browser on startup")
	appMode := flag.Bool("app", true, "prefer Chrome/Edge --app mode (no URL bar)")
	flag.Parse()

	handler, err := api.NewHandler(*dir)
	if err != nil {
		log.Fatalf("Failed to initialize handler: %v", err)
	}

	r := gin.Default()
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "version": version, "dir": *dir})
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
	r.GET("/api/games/:id/unitclasses", handler.GetUnitClasses)
	r.PUT("/api/games/:id/unitclasses", handler.SetUnitClasses)
	r.POST("/api/upload", handler.UploadGame)
	r.DELETE("/api/games/:id", handler.DeleteGame)
	r.GET("/ws/games/:id/stream", ws.HandleStream(handler.GetService))

	serveStatic(r)

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("Wargame Replay %s — starting on %s, scanning %s", version, addr, *dir)

	go func() {
		for i := 0; i < 30; i++ {
			resp, err := http.Get("http://" + addr + "/api/health")
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == 200 {
					if *openBrowser {
						if *appMode {
							_ = browser.Open("http://" + addr)
						} else {
							_ = browser.OpenDefault("http://" + addr)
						}
					}
					return
				}
			}
			time.Sleep(500 * time.Millisecond)
		}
	}()

	log.Fatal(r.Run(addr))
}
