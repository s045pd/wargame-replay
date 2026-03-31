package game

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"sort"
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
	Type     string                 `json:"type"`
	Ts       string                 `json:"ts"`
	Units    []decoder.UnitPosition `json:"units"`
	Events   []decoder.GameEvent    `json:"events"`
	Hotspots []hotspot.HotspotEvent `json:"hotspots,omitempty"`
	POIs     []decoder.POIObject    `json:"pois,omitempty"`
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
	hotspotEvents []hotspot.HotspotEvent
	// HP timeline per unit: sorted by timestamp ascending
	hpTimeline map[int][]hpEntry
	// hitEvents indexed by timestamp for frame enrichment
	hitEventsByTs map[string][]decoder.GameEvent
	// sorted unique timestamps that have events (for binary search in collectEvents)
	hitTimestamps []string
	// shooterAliveTs: sorted timestamps at which each unit was the SOURCE of a hit/kill.
	// Used as "proof of life" — a unit that fires a shot is necessarily alive.
	shooterAliveTs map[int][]string
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
		hpTimeline:     make(map[int][]hpEntry),
		hitEventsByTs:  make(map[string][]decoder.GameEvent),
		shooterAliveTs: make(map[int][]string),
		unitClasses:    ucfg,
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

			// Track shooter "proof of life" — a unit that fires a shot is alive.
			// This handles respawns that generate no explicit revive event.
			shooterID := hitEvents[i].SrcID
			evType := hitEvents[i].Type
			if shooterID != 0 && shooterID != victimID && (evType == "kill" || evType == "hit") {
				sts := svc.shooterAliveTs[shooterID]
				// Deduplicate: only append if timestamp is new (events are sorted by ts)
				if len(sts) == 0 || sts[len(sts)-1] != ts {
					svc.shooterAliveTs[shooterID] = append(sts, ts)
				}
			}
		}
	}

	// Build sorted timestamp index for binary search in collectEvents.
	svc.hitTimestamps = make([]string, 0, len(svc.hitEventsByTs))
	for ts := range svc.hitEventsByTs {
		svc.hitTimestamps = append(svc.hitTimestamps, ts)
	}
	sort.Strings(svc.hitTimestamps)

	// Detect hotspot events from cache or compute.
	allEvents, _ := decoder.LoadAllEvents(db)
	if cached, ok := hotspot.LoadCache(dbPath); ok {
		svc.hotspotEvents = cached
	} else {
		detected := hotspot.DetectHotspotEvents(db, resolver, allEvents, gameMeta.BombingEvents)
		svc.hotspotEvents = detected
		log.Printf("Detected %d hotspot events for %s", len(detected), dbPath)
		if saveErr := hotspot.SaveCache(dbPath, detected); saveErr != nil {
			log.Printf("hotspot cache save error: %v", saveErr)
		}
	}

	// Populate FocusName from players map for killstreak events
	for i := range svc.hotspotEvents {
		if svc.hotspotEvents[i].FocusUnitID != 0 {
			if name, ok := players[svc.hotspotEvents[i].FocusUnitID]; ok {
				svc.hotspotEvents[i].FocusName = name
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

// HotspotEvents returns the full list of detected hotspot events.
func (s *Service) HotspotEvents() []hotspot.HotspotEvent {
	return s.hotspotEvents
}

// UnitClasses returns the unit class configuration.
func (s *Service) UnitClasses() *UnitClassConfig {
	return s.unitClasses
}

// ActiveHotspots returns all hotspot events whose time range includes ts.
func (s *Service) ActiveHotspots(ts string) []hotspot.HotspotEvent {
	var active []hotspot.HotspotEvent
	for _, h := range s.hotspotEvents {
		if ts >= h.StartTs && ts <= h.EndTs {
			active = append(active, h)
		}
	}
	return active
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
	type unitEntry struct {
		pos decoder.UnitPosition
		ts  string // timestamp of the position record this unit came from
	}
	unitMap := make(map[uint16]unitEntry)
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
			unitMap[u.ID] = unitEntry{pos: u, ts: rowTs} // newer records overwrite older ones
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

	// Convert map to slice, resolve coordinates, attach names, HP, and class.
	// Use per-unit position timestamps to reconcile alive/dead with HP timeline.
	units := make([]decoder.UnitPosition, 0, len(unitMap))
	for _, ue := range unitMap {
		u := ue.pos
		posTs := ue.ts
		posAlive := u.Alive // raw position alive flag (flags[3] == 0xFE/0xFF)

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
		// Reconcile with position alive flag using per-unit timestamps:
		// - If position data is more recent than the last HP event, trust position flags
		//   (handles respawns/revivals that don't generate a 0x41 event).
		// - If HP event is more recent, trust HP for alive/dead determination.
		// - Proof-of-life override: if the unit fired a shot after their recorded death,
		//   they must have respawned — force alive.
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
				lastEventTs := timeline[bestIdx].Ts
				u.HP = timeline[bestIdx].HP

				if posTs >= lastEventTs {
					// Position data recorded AT or AFTER the last HP event —
					// position alive flag is authoritative.
					if posAlive && u.HP <= 0 {
						u.HP = 100 // respawned without explicit revive event
					} else if !posAlive && u.HP > 0 {
						u.HP = 0 // died without a recorded kill event
					}
					u.Alive = posAlive
				} else {
					// HP event is more recent — HP determines alive/dead
					u.Alive = u.HP > 0
				}

				// Proof-of-life: if unit is marked dead but fired a shot AFTER their
				// death event and before/at actualTs, they must have respawned.
				if !u.Alive {
					if shootTimes, ok := s.shooterAliveTs[int(u.ID)]; ok {
						// Binary search: latest shoot time <= actualTs
						sLo, sHi := 0, len(shootTimes)-1
						sBest := -1
						for sLo <= sHi {
							sMid := (sLo + sHi) / 2
							if shootTimes[sMid] <= actualTs {
								sBest = sMid
								sLo = sMid + 1
							} else {
								sHi = sMid - 1
							}
						}
						if sBest >= 0 && shootTimes[sBest] > lastEventTs {
							// Unit fired after recorded death → alive
							u.Alive = true
							u.HP = 100
						}
					}
				}
			}
		}

		units = append(units, u)
	}

	// Collect events: default window is actualTs..ts (1-second)
	events := s.collectEvents(actualTs, ts)

	// Frame-level cross-reference: if a unit appears as shooter (SrcID) in this
	// frame's events but is marked dead, force alive. This is a belt-and-suspenders
	// safety net — the HP timeline proof-of-life should handle most cases, but the
	// frame events may fall in a gap between position records.
	shooterInFrame := make(map[uint16]bool)
	for _, ev := range events {
		if ev.SrcID != 0 && ev.SrcID != ev.DstID && (ev.Type == "kill" || ev.Type == "hit") {
			shooterInFrame[uint16(ev.SrcID)] = true
		}
	}
	if len(shooterInFrame) > 0 {
		for i := range units {
			if !units[i].Alive && shooterInFrame[units[i].ID] {
				units[i].Alive = true
				if units[i].HP <= 0 {
					units[i].HP = 100
				}
			}
		}
	}

	frame := &Frame{
		Type:     "frame",
		Ts:       actualTs,
		Units:    units,
		Events:   events,
		Hotspots: s.ActiveHotspots(actualTs),
		POIs:     pois,
	}

	if data, err := json.Marshal(frame); err == nil {
		s.cache.Put(ts, data)
	}

	return frame, nil
}

// collectEvents gathers all hit/kill events with fromTs <= ev.Ts <= toTs.
// Uses binary search on sorted hitTimestamps for O(log N + K) performance
// instead of O(N) full scan.
func (s *Service) collectEvents(fromTs, toTs string) []decoder.GameEvent {
	events := make([]decoder.GameEvent, 0)

	// Binary search for the first timestamp >= fromTs
	startIdx := sort.SearchStrings(s.hitTimestamps, fromTs)

	for i := startIdx; i < len(s.hitTimestamps); i++ {
		ts := s.hitTimestamps[i]
		if ts > toTs {
			break
		}
		events = append(events, s.hitEventsByTs[ts]...)
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
