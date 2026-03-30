package main

import (
	"flag"
	"fmt"
	"log"
	"wargame-replay/server/api"
	"wargame-replay/server/ws"

	"github.com/gin-gonic/gin"
)

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
	r.GET("/ws/games/:id/stream", ws.HandleStream(handler.GetService))

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("Starting server on %s, scanning %s", addr, *dir)
	log.Fatal(r.Run(addr))
}
