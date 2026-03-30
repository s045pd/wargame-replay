package game

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"wargame-replay/server/decoder"
	"wargame-replay/server/hotspot"
	"wargame-replay/server/index"

	_ "github.com/mattn/go-sqlite3"
)

type PlayerInfo struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Team string `json:"team"`
}

type GameMeta struct {
	CoordMode string       `json:"coordMode"`
	StartTime string       `json:"startTime"`
	EndTime   string       `json:"endTime"`
	Players   []PlayerInfo `json:"players"`
}

type Frame struct {
	Type    string                 `json:"type"`
	Ts      string                 `json:"ts"`
	Units   []decoder.UnitPosition `json:"units"`
	Events  []decoder.GameEvent    `json:"events"`
	Hotspot *HotspotInfo           `json:"hotspot,omitempty"`
}

type HotspotInfo struct {
	Score  float32    `json:"score"`
	Center [2]float64 `json:"center"`
	Radius float32    `json:"radius"`
}

type Service struct {
	db       *sql.DB
	idx      *index.TimeIndex
	cache    *index.LRUCache
	resolver decoder.CoordResolver
	players  map[int]string
	meta     GameMeta
	dbPath   string
	hotspots []hotspot.HotspotFrame
}

const cacheMaxBytes = 100 * 1024 * 1024 // 100MB

func LoadGame(dbPath string) (*Service, error) {
	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return nil, err
	}

	idx, err := index.BuildTimeIndex(db)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("build index: %w", err)
	}

	resolver, coordMode, err := decoder.AutoDetectCoords(db)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("detect coords: %w", err)
	}

	players := loadPlayers(db)

	svc := &Service{
		db:       db,
		idx:      idx,
		cache:    index.NewLRUCache(cacheMaxBytes),
		resolver: resolver,
		players:  players,
		dbPath:   dbPath,
		meta: GameMeta{
			CoordMode: string(coordMode),
			StartTime: idx.StartTime(),
			EndTime:   idx.EndTime(),
			Players:   buildPlayerList(players),
		},
	}

	// Load hotspot data from cache or compute it.
	if frames, ok := hotspot.LoadCache(dbPath); ok {
		svc.hotspots = frames
	} else {
		events, _ := decoder.LoadAllEvents(db)
		frames, err := hotspot.ComputeHotspots(db, idx, resolver, events)
		if err != nil {
			log.Printf("hotspot compute error for %s: %v", dbPath, err)
		} else {
			svc.hotspots = frames
			if saveErr := hotspot.SaveCache(dbPath, frames); saveErr != nil {
				log.Printf("hotspot cache save error: %v", saveErr)
			}
		}
	}

	return svc, nil
}

func (s *Service) Close() {
	s.db.Close()
}

func (s *Service) Meta() GameMeta {
	return s.meta
}

func (s *Service) TimeIndex() *index.TimeIndex {
	return s.idx
}

// Hotspots returns the full precomputed hotspot timeline.
func (s *Service) Hotspots() []hotspot.HotspotFrame {
	return s.hotspots
}

// HotspotAt returns a HotspotInfo for the frame nearest to ts, or nil if none.
func (s *Service) HotspotAt(ts string) *HotspotInfo {
	if len(s.hotspots) == 0 {
		return nil
	}
	// Linear scan is fine: hotspots slice is at most ~500 entries.
	// Find the closest frame by string comparison (timestamps are lexicographically sortable).
	best := 0
	for i := 1; i < len(s.hotspots); i++ {
		if s.hotspots[i].Ts <= ts {
			best = i
		} else {
			break
		}
	}
	f := s.hotspots[best]
	if len(f.TopRegions) == 0 {
		return nil
	}
	top := f.TopRegions[0]
	return &HotspotInfo{
		Score:  top.Score,
		Center: [2]float64{top.CenterLat, top.CenterLng},
		Radius: top.Radius,
	}
}

func (s *Service) GetFrame(ts string) (*Frame, error) {
	if cached, ok := s.cache.Get(ts); ok {
		var f Frame
		json.Unmarshal(cached, &f)
		return &f, nil
	}

	rowID, found := s.idx.Lookup(ts)
	if !found {
		return nil, fmt.Errorf("timestamp %s not found", ts)
	}

	var blob []byte
	var actualTs string
	err := s.db.QueryRow(
		"SELECT LogTime, LogData FROM record WHERE ID >= ? AND SrcType=1 AND DataType=1 LIMIT 1",
		rowID,
	).Scan(&actualTs, &blob)
	if err != nil {
		return nil, err
	}

	units := decoder.DecodePositionFrame(blob)
	for i := range units {
		lat, lng := s.resolver.Convert(units[i].RawLat, units[i].RawLng)
		if s.resolver.Mode() == decoder.CoordWGS84 {
			units[i].Lat = lat
			units[i].Lng = lng
		} else {
			units[i].X = lat
			units[i].Y = lng
		}
	}

	frame := &Frame{
		Type:    "frame",
		Ts:      actualTs,
		Units:   units,
		Hotspot: s.HotspotAt(actualTs),
	}

	if data, err := json.Marshal(frame); err == nil {
		s.cache.Put(ts, data)
	}

	return frame, nil
}

func loadPlayers(db *sql.DB) map[int]string {
	players := make(map[int]string)
	rows, err := db.Query("SELECT SrcIndex, TagText FROM tag WHERE SrcType=1 AND TagText <> '' GROUP BY SrcIndex")
	if err != nil {
		return players
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var name string
		rows.Scan(&id, &name)
		players[id] = name
	}
	return players
}

func buildPlayerList(players map[int]string) []PlayerInfo {
	list := make([]PlayerInfo, 0, len(players))
	for id, name := range players {
		team := "unknown"
		if id >= 21 && id <= 49 {
			team = "red"
		} else if id >= 50 && id <= 76 {
			team = "blue"
		} else if id >= 500 {
			team = "observer"
		}
		list = append(list, PlayerInfo{ID: id, Name: name, Team: team})
	}
	return list
}
