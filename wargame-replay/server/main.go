package main

import (
	"flag"
	"fmt"
	"log"

	"github.com/gin-gonic/gin"
)

func main() {
	dir := flag.String("dir", ".", "Directory containing .db files")
	host := flag.String("host", "127.0.0.1", "Listen host")
	port := flag.Int("port", 8080, "Listen port")
	flag.Parse()

	r := gin.Default()
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "dir": *dir})
	})

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("Starting server on %s, scanning %s", addr, *dir)
	log.Fatal(r.Run(addr))
}
