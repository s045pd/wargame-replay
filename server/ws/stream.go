package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"wargame-replay/server/game"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Command struct {
	Cmd   string `json:"cmd"`
	To    string `json:"to,omitempty"`
	Speed int    `json:"speed,omitempty"`
}

type StateMsg struct {
	Type      string `json:"type"`
	Ts        string `json:"ts"`
	Status    string `json:"status"`
	Speed     int    `json:"speed"`
	CoordMode string `json:"coordMode"`
}

type streamState struct {
	mu       sync.Mutex
	playing  bool
	speed    int
	currentI int
	svc      *game.Service
}

func HandleStream(getService func(string) (*game.Service, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		gameID := c.Param("id")
		svc, err := getService(gameID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("ws upgrade error: %v", err)
			return
		}
		defer conn.Close()

		state := &streamState{speed: 1, currentI: 0, svc: svc}
		meta := svc.Meta()

		initMsg := StateMsg{
			Type:      "state",
			Ts:        meta.StartTime,
			Status:    "paused",
			Speed:     1,
			CoordMode: meta.CoordMode,
		}
		conn.WriteJSON(initMsg)

		cmdCh := make(chan Command, 10)
		go func() {
			for {
				var cmd Command
				if err := conn.ReadJSON(&cmd); err != nil {
					close(cmdCh)
					return
				}
				cmdCh <- cmd
			}
		}()

		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()

		for {
			select {
			case cmd, ok := <-cmdCh:
				if !ok {
					return
				}
				state.handleCommand(cmd, svc, conn)
			case <-ticker.C:
				state.mu.Lock()
				if state.playing {
					state.sendFrame(conn, svc)
					state.currentI += state.speed
				}
				state.mu.Unlock()
			}
		}
	}
}

func (s *streamState) handleCommand(cmd Command, svc *game.Service, conn *websocket.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()

	idx := svc.TimeIndex()
	switch cmd.Cmd {
	case "play":
		s.playing = true
		if cmd.Speed > 0 {
			s.speed = cmd.Speed
		}
	case "pause":
		s.playing = false
	case "seek":
		ts := strings.Replace(cmd.To, "T", " ", 1)
		s.currentI = idx.IndexOf(ts)
		if !s.playing {
			s.sendFrame(conn, svc)
		}
	}
}

func (s *streamState) sendFrame(conn *websocket.Conn, svc *game.Service) {
	idx := svc.TimeIndex()
	ts, ok := idx.TimestampAt(s.currentI)
	if !ok {
		s.playing = false
		return
	}
	frame, err := svc.GetFrame(ts)
	if err != nil {
		return
	}
	data, _ := json.Marshal(frame)
	conn.WriteMessage(websocket.TextMessage, data)
}
