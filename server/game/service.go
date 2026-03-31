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

type Bounds struct {
	MinLat float64 `json:"minLat"`
	MaxLat float64 `json:"maxLat"`
	MinLng float64 `json:"minLng"`
	MaxLng float64 `json:"maxLng"`
}

type Graticule struct {
	LatBegin float64 `json:"latBegin"`
	LatSpace float64 `json:"latSpace"`
	LngBegin float64 `json:"lngBegin"`
	LngSpace float64 `json:"lngSpace"`
	CR       int     `json:"cr"` // grid cell count reference
}

type GameMeta struct {
	CoordMode     string                 `json:"coordMode"`
	StartTime     string                 `json:"startTime"`
	EndTime       string                 `json:"endTime"`
	Players       []PlayerInfo           `json:"players"`
	CenterLat     float64                `json:"centerLat,omitempty"`
	CenterLng     float64                `json:"centerLng,omitempty"`
	Bounds        *Bounds                `json:"bounds,omitempty"`
	BaseCamps     []decoder.BaseCamp     `json:"baseCamps,omitempty"`
	Graticule     *Graticule             `json:"graticule,omitempty"`
	BombingEvents []decoder.BombingEvent `json:"bombingEvents,omitempty"`
}

type Frame struct {
	Type    string                 `json:"type"`
	Ts      string                 `json:"ts"`
	Units   []decoder.UnitPosition `json:"units"`
	Events  []decoder.GameEvent    `json:"events"`
	Hotspot *HotspotInfo           `json:"hotspot,omitempty"`
	POIs    []decoder.POIObject    `json:"pois,omitempty"`
}

type HotspotInfo struct {
	Score  float32    `json:"score"`
	Center [2]float64 `json:"center"`
	Radius float32    `json:"radius"`
}

// hpEntry stores a unit's HP at a specific timestamp.
type hpEntry struct {
	Ts string
	HP int
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
	// HP timeline per unit: sorted by timestamp ascending
	hpTimeline map[int][]hpEntry
	// hitEvents indexed by timestamp for frame enrichment
	hitEventsByTs map[string][]decoder.GameEvent
	// Unit class configuration
	unitClasses *UnitClassConfig
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

	resolver, coordMode, err := decoder.AutoDetectCoords(db, dbPath)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("detect coords: %w", err)
	}

	players := loadPlayers(db)

	gameMeta := GameMeta{
		CoordMode: string(coordMode),
		StartTime: idx.StartTime(),
		EndTime:   idx.EndTime(),
		Players:   buildPlayerList(players),
	}

	// Include center coordinates and graticule from .txt metadata if available
	if mapMeta, err := decoder.LoadMapMeta(dbPath); err == nil && mapMeta != nil {
		gameMeta.CenterLat = mapMeta.CenterLat
		gameMeta.CenterLng = mapMeta.CenterLng
		if mapMeta.GratLatSpace > 0 && mapMeta.GratLngSpace > 0 {
			gameMeta.Graticule = &Graticule{
				LatBegin: mapMeta.GratLatBegin,
				LatSpace: mapMeta.GratLatSpace,
				LngBegin: mapMeta.GratLngBegin,
				LngSpace: mapMeta.GratLngSpace,
				CR:       mapMeta.GratCR,
			}
		}
	}

	// Compute WGS84 bounds from all position data
	if resolver.Mode() == decoder.CoordWGS84 {
		if bounds := computeWGS84Bounds(db, resolver); bounds != nil {
			gameMeta.Bounds = bounds
		}
	}

	// Compute base camps from earliest position frames
	if resolver.Mode() == decoder.CoordWGS84 {
		if camps := decoder.ComputeBaseCamps(db, resolver); len(camps) > 0 {
			gameMeta.BaseCamps = camps
		}
	}

	// Load bombing/special battlefield events
	if bombEvents, err := decoder.LoadBombingEvents(db); err == nil && len(bombEvents) > 0 {
		for i := range bombEvents {
			lat, lng := resolver.Convert(bombEvents[i].RawLat, bombEvents[i].RawLng)
			bombEvents[i].Lat = lat
			bombEvents[i].Lng = lng
		}
		gameMeta.BombingEvents = bombEvents
	}

	ucfg := LoadUnitClassConfig(dbPath)

	svc := &Service{
		db:            db,
		idx:           idx,
		cache:         index.NewLRUCache(cacheMaxBytes),
		resolver:      resolver,
		players:       players,
		dbPath:        dbPath,
		meta:          gameMeta,
		hpTimeline:    make(map[int][]hpEntry),
		hitEventsByTs: make(map[string][]decoder.GameEvent),
		unitClasses:   ucfg,
	}

	// Load hit events, index by timestamp, and build HP timeline
	hitEvents, err := decoder.LoadHitEvents(db)
	if err != nil {
		log.Printf("hit event load warning for %s: %v", dbPath, err)
	} else {
		for i := range hitEvents {
			// Attach player names and class info
			hitEvents[i].SrcName = players[hitEvents[i].SrcID]
			hitEvents[i].DstName = players[hitEvents[i].DstID]
			hitEvents[i].SrcClass = ucfg.Get(hitEvents[i].SrcID)
			hitEvents[i].DstClass = ucfg.Get(hitEvents[i].DstID)
			ts := hitEvents[i].Ts
			svc.hitEventsByTs[ts] = append(svc.hitEventsByTs[ts], hitEvents[i])

			// Build HP timeline for the victim
			victimID := hitEvents[i].DstID
			svc.hpTimeline[victimID] = append(svc.hpTimeline[victimID], hpEntry{
				Ts: ts,
				HP: hitEvents[i].HP,
			})
		}
	}

	// Load hotspot data from cache or compute it.
	allEvents, _ := decoder.LoadAllEvents(db)
	if frames, ok := hotspot.LoadCache(dbPath); ok {
		svc.hotspots = frames
	} else {
		frames, err := hotspot.ComputeHotspots(db, idx, resolver, allEvents)
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

// UnitClasses returns the unit class configuration.
func (s *Service) UnitClasses() *UnitClassConfig {
	return s.unitClasses
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

// accumWindow is the number of seconds to look back when accumulating unit positions.
// Each DB record contains only a subset (~26) of all units; over 5 seconds the full
// set (~136+) cycles through.
const accumWindow = 5

func (s *Service) GetFrame(ts string) (*Frame, error) {
	if cached, ok := s.cache.Get(ts); ok {
		var f Frame
		json.Unmarshal(cached, &f)
		return &f, nil
	}

	_, found := s.idx.Lookup(ts)
	if !found {
		return nil, fmt.Errorf("timestamp %s not found", ts)
	}

	// Accumulate DataType=1 position records over a sliding window.
	// Each record only contains ~26 units; we need multiple seconds to see all.
	unitMap := make(map[uint16]decoder.UnitPosition)
	var actualTs string

	rows, err := s.db.Query(
		`SELECT LogTime, LogData FROM record
		 WHERE SrcType=1 AND DataType=1
		   AND LogTime >= datetime(?, '-' || ? || ' seconds')
		   AND LogTime <= ?
		 ORDER BY LogTime ASC`,
		ts, accumWindow, ts,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var rowTs string
		var blob []byte
		if err := rows.Scan(&rowTs, &blob); err != nil {
			continue
		}
		actualTs = rowTs // last (most recent) timestamp
		for _, u := range decoder.DecodePositionFrame(blob) {
			unitMap[u.ID] = u // newer records overwrite older ones
		}
	}

	// Parse DataType=8 as POI objects (battlefield facilities)
	var pois []decoder.POIObject
	rows8, err := s.db.Query(
		`SELECT LogData FROM record
		 WHERE SrcType=64 AND DataType=8
		   AND LogTime >= datetime(?, '-1 seconds') AND LogTime <= ?
		 ORDER BY LogTime DESC LIMIT 1`,
		ts, ts,
	)
	if err == nil {
		defer rows8.Close()
		for rows8.Next() {
			var blob []byte
			if err := rows8.Scan(&blob); err != nil {
				continue
			}
			for _, poi := range decoder.DecodeDT8POIs(blob) {
				// Convert raw coords stored in Lat/Lng
				lat, lng := s.resolver.Convert(uint32(poi.Lat), uint32(poi.Lng))
				poi.Lat = lat
				poi.Lng = lng
				pois = append(pois, poi)
			}
		}
	}

	if actualTs == "" {
		actualTs = ts
	}

	// Convert map to slice, resolve coordinates, attach names, HP, and class
	units := make([]decoder.UnitPosition, 0, len(unitMap))
	for _, u := range unitMap {
		lat, lng := s.resolver.Convert(u.RawLat, u.RawLng)
		if s.resolver.Mode() == decoder.CoordWGS84 {
			u.Lat = lat
			u.Lng = lng
		} else {
			u.X = lat
			u.Y = lng
		}
		if name, ok := s.players[int(u.ID)]; ok {
			u.Name = name
		}
		u.Class = s.unitClasses.Get(int(u.ID))

		// Apply HP from timeline: find latest hit event for this unit <= actualTs.
		// HP timeline is the source of truth for alive/dead status.
		if timeline, ok := s.hpTimeline[int(u.ID)]; ok {
			// Binary search for the latest entry <= actualTs
			lo, hi := 0, len(timeline)-1
			bestIdx := -1
			for lo <= hi {
				mid := (lo + hi) / 2
				if timeline[mid].Ts <= actualTs {
					bestIdx = mid
					lo = mid + 1
				} else {
					hi = mid - 1
				}
			}
			if bestIdx >= 0 {
				u.HP = timeline[bestIdx].HP
				// HP is authoritative: override the raw position flag
				u.Alive = u.HP > 0
			}
		}

		units = append(units, u)
	}

	// Collect events: default window is actualTs..ts (1-second)
	events := s.collectEvents(actualTs, ts)

	frame := &Frame{
		Type:    "frame",
		Ts:      actualTs,
		Units:   units,
		Events:  events,
		Hotspot: s.HotspotAt(actualTs),
		POIs:    pois,
	}

	if data, err := json.Marshal(frame); err == nil {
		s.cache.Put(ts, data)
	}

	return frame, nil
}

// collectEvents gathers all hit/kill events with fromTs < ev.Ts <= toTs.
func (s *Service) collectEvents(fromTs, toTs string) []decoder.GameEvent {
	events := make([]decoder.GameEvent, 0)
	for _, evts := range s.hitEventsByTs {
		for _, ev := range evts {
			if ev.Ts > fromTs && ev.Ts <= toTs {
				events = append(events, ev)
			}
		}
	}
	// Also include exact-match events at toTs boundary
	if evts, ok := s.hitEventsByTs[toTs]; ok {
		for _, ev := range evts {
			found := false
			for _, existing := range events {
				if existing.Ts == ev.Ts && existing.SrcID == ev.SrcID && existing.DstID == ev.DstID {
					found = true
					break
				}
			}
			if !found {
				events = append(events, ev)
			}
		}
	}
	// Include exact-match events at fromTs boundary (for single-second frames)
	if evts, ok := s.hitEventsByTs[fromTs]; ok {
		for _, ev := range evts {
			found := false
			for _, existing := range events {
				if existing.Ts == ev.Ts && existing.SrcID == ev.SrcID && existing.DstID == ev.DstID {
					found = true
					break
				}
			}
			if !found {
				events = append(events, ev)
			}
		}
	}
	return events
}

// GetFrameRange returns a frame at `ts` but collects events from `fromTs` to `ts`.
// This ensures no events are skipped during fast-forward playback.
func (s *Service) GetFrameRange(fromTs, ts string) (*Frame, error) {
	// Get the base frame (positions, POIs, etc.) — may be cached
	frame, err := s.GetFrame(ts)
	if err != nil {
		return nil, err
	}
	// If fromTs is empty or same as frame.Ts, just return as-is
	if fromTs == "" || fromTs >= frame.Ts {
		return frame, nil
	}
	// Re-collect events over the wider range
	frame.Events = s.collectEvents(fromTs, ts)
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
		team := "red"
		if id >= 500 {
			team = "blue"
		}
		list = append(list, PlayerInfo{ID: id, Name: name, Team: team})
	}
	return list
}

// computeWGS84Bounds scans position records to determine the full spatial extent.
func computeWGS84Bounds(db *sql.DB, resolver decoder.CoordResolver) *Bounds {
	rows, err := db.Query(`
		SELECT LogData FROM record
		WHERE SrcType=1 AND DataType=1 AND LogData IS NOT NULL
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	minLat, minLng := 999.0, 999.0
	maxLat, maxLng := -999.0, -999.0
	count := 0

	for rows.Next() {
		var blob []byte
		if err := rows.Scan(&blob); err != nil {
			continue
		}
		for _, u := range decoder.DecodePositionFrame(blob) {
			if u.RawLat == 0 && u.RawLng == 0 {
				continue
			}
			lat, lng := resolver.Convert(u.RawLat, u.RawLng)
			if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
				continue
			}
			if lat < minLat {
				minLat = lat
			}
			if lat > maxLat {
				maxLat = lat
			}
			if lng < minLng {
				minLng = lng
			}
			if lng > maxLng {
				maxLng = lng
			}
			count++
		}
	}

	if count == 0 {
		return nil
	}

	return &Bounds{
		MinLat: minLat,
		MaxLat: maxLat,
		MinLng: minLng,
		MaxLng: maxLng,
	}
}
