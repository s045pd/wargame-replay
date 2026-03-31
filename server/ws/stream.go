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
	prevTs   string // timestamp of the last sent frame — used for event range
	svc      *game.Service
}

// tickParams computes the tick interval and frame step for the given speed.
//
// At low speeds (1–16x) we deliver one frame per game-second, so the tick
// interval equals 1/speed seconds (minimum 60 ms).
// At high speeds (>16x) we cap the frame rate at ~16 fps and increase the
// step so that units trace their actual trajectory instead of teleporting.
func tickParams(speed int) (interval time.Duration, step int) {
	if speed <= 0 {
		speed = 1
	}
	const maxFPS = 16
	if speed <= maxFPS {
		interval = time.Second / time.Duration(speed)
		if interval < 60*time.Millisecond {
			interval = 60 * time.Millisecond
		}
		return interval, 1
	}
	// High-speed mode: cap frame rate, increase step proportionally.
	interval = time.Second / maxFPS // ~62 ms
	step = (speed + maxFPS/2) / maxFPS
	if step < 1 {
		step = 1
	}
	return interval, step
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

		// Dynamic ticker: interval adjusts with speed so high-speed playback
		// delivers many small-step frames instead of one giant jump per second.
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()

		for {
			select {
			case cmd, ok := <-cmdCh:
				if !ok {
					return
				}
				state.handleCommand(cmd, svc, conn)
				// Adjust ticker to match the new speed
				state.mu.Lock()
				if state.playing {
					interval, _ := tickParams(state.speed)
					ticker.Reset(interval)
				}
				state.mu.Unlock()
			case <-ticker.C:
				state.mu.Lock()
				if state.playing {
					_, step := tickParams(state.speed)
					state.sendFrame(conn, svc)
					state.currentI += step
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
		s.prevTs = "" // reset range on seek
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

	// Use GetFrameRange to collect events from prevTs..ts (covers fast-forward gaps)
	frame, err := svc.GetFrameRange(s.prevTs, ts)
	if err != nil {
		return
	}

	// Track this timestamp for next frame's event range
	s.prevTs = ts

	data, _ := json.Marshal(frame)
	conn.WriteMessage(websocket.TextMessage, data)
}
