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
	// Unit class configuration (sidecar override)
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
		unitClasses:    ucfg,
	}

	// Load hit events, index by timestamp, and build HP timeline.
	// Deduplicate events: some databases contain duplicate rows for the same
	// (type, srcID, dstID, timestamp, HP) combination.
	// HP is included in the key so that successive hits in the same second
	// from the same shooter are preserved (e.g. two rapid shots reducing
	// HP from 70→40 — same src/dst/ts but different HP).
	type evKey struct {
		Type  string
		SrcID int
		DstID int
		Ts    string
		HP    int
	}
	seenEvents := make(map[evKey]bool)

	hitEvents, err := decoder.LoadHitEvents(db)
	if err != nil {
		log.Printf("hit event load warning for %s: %v", dbPath, err)
	} else {
		for i := range hitEvents {
			// Deduplicate: skip if exact same (type, src, dst, ts) already seen
			k := evKey{hitEvents[i].Type, hitEvents[i].SrcID, hitEvents[i].DstID, hitEvents[i].Ts, hitEvents[i].HP}
			if seenEvents[k] {
				continue
			}
			seenEvents[k] = true

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

	// Ensure per-unit HP timelines are sorted for binary search correctness.
	for id := range svc.hpTimeline {
		sort.Slice(svc.hpTimeline[id], func(i, j int) bool {
			return svc.hpTimeline[id][i].Ts < svc.hpTimeline[id][j].Ts
		})
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

// ClearFrameCache invalidates all cached frames, forcing recomputation.
// Used after changes to unit classes or other frame-level metadata.
func (s *Service) ClearFrameCache() {
	s.cache.Clear()
}

// KillEvents returns all kill-type events, sorted by timestamp.
// Used by the kill leaderboard so clients don't rely on incremental accumulation.
func (s *Service) KillEvents() []decoder.GameEvent {
	var kills []decoder.GameEvent
	for _, ts := range s.hitTimestamps {
		for _, ev := range s.hitEventsByTs[ts] {
			if ev.Type == "kill" {
				kills = append(kills, ev)
			}
		}
	}
	return kills
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
// Each DB record contains only a subset (~26) of all units; over 7 seconds the full
// set (~136+) cycles through. 7s captures slightly more units than 5s.
const accumWindow = 7

func (s *Service) GetFrame(ts string) (*Frame, error) {
	if cached, ok := s.cache.Get(ts); ok {
		var f Frame
		if err := json.Unmarshal(cached, &f); err == nil {
			return &f, nil
		}
		// Corrupt cache entry — fall through to recompute
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
			// Skip ghost/garbage IDs (e.g. 32768+) that appear in some databases.
			// Only include units present in the player tag table.
			if _, known := s.players[int(u.ID)]; !known {
				continue
			}
			unitMap[u.ID] = u // newer records overwrite older ones
		}
	}

	// Fallback: for units missing from the 7-second window (e.g. stationary units
	// whose positions stopped being reported), search a wider 120-second window.
	// Scan backwards (DESC) so we find the most recent position first.
	if len(unitMap) < len(s.players) {
		missing := make(map[uint16]bool)
		for id := range s.players {
			uid := uint16(id)
			if _, ok := unitMap[uid]; !ok {
				missing[uid] = true
			}
		}
		if len(missing) > 0 {
			const fallbackWindow = 120
			fbRows, fbErr := s.db.Query(
				`SELECT LogData FROM record
				 WHERE SrcType=1 AND DataType=1
				   AND LogTime >= datetime(?, '-' || ? || ' seconds')
				   AND LogTime < datetime(?, '-' || ? || ' seconds')
				 ORDER BY LogTime DESC`,
				ts, fallbackWindow, ts, accumWindow,
			)
			if fbErr == nil {
				for fbRows.Next() && len(missing) > 0 {
					var blob []byte
					if err := fbRows.Scan(&blob); err != nil {
						continue
					}
					for _, u := range decoder.DecodePositionFrame(blob) {
						if missing[u.ID] {
							if _, known := s.players[int(u.ID)]; known {
								unitMap[u.ID] = u
								delete(missing, u.ID)
							}
						}
					}
				}
				fbRows.Close()
			}
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

	// Convert map to slice, resolve coordinates, attach names, and reconcile HP.
	//
	// HP reconciliation strategy:
	//   Alive/dead comes from position flags[0] (>0 means alive). This is the
	//   ground truth for alive/dead status — it reflects revivals that generate
	//   no explicit event. Position HP defaults to 100 (alive) or 0 (dead).
	//
	//   The event timeline provides the actual HP values (from hit/kill/heal
	//   events). When event data is available, it overrides the default HP.
	//
	//   Conflict resolution:
	//     - Position says alive + event says HP=0 → unit was revived silently → HP=100
	//     - Position says dead + event says HP>0 → killed since last event → HP=0
	//     - Position says alive + event says HP>0 → trust event HP
	//
	//   Class comes from position flags[1] (decoded in DecodePositionEntry),
	//   with unitclasses.json sidecar as a user-override.
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
		// Use sidecar override if present, otherwise keep class from position flags
		if override := s.unitClasses.Get(int(u.ID)); override != string(decoder.ClassRifle) {
			u.Class = override
		}

		// Reconcile HP with event timeline.
		// Position data provides alive/dead truth; event timeline provides actual HP.
		if timeline, ok := s.hpTimeline[int(u.ID)]; ok {
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
				eventHP := timeline[bestIdx].HP
				if u.Alive {
					// Position says alive.
					if eventHP > 0 {
						// Event agrees alive — use event HP (actual damage value).
						u.HP = eventHP
					}
					// else: event says HP=0 but position says alive →
					//   unit was revived (silent revival). Keep default HP=100.
				} else {
					// Position says dead → trust it. HP=0 already set by decoder.
					u.HP = 0
				}
			}
		}

		units = append(units, u)
	}

	// Collect events: default window is actualTs..ts (1-second)
	events := s.collectEvents(actualTs, ts)

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
// The lower bound is exclusive: events at exactly fromTs were already delivered
// in the previous frame, so we use the range (fromTs, ts] to prevent duplicates.
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
	// Re-collect events over the wider range with exclusive lower bound
	frame.Events = s.collectEventsAfter(fromTs, ts)
	return frame, nil
}

// collectEventsAfter gathers events with fromTs < ev.Ts <= toTs (exclusive lower bound).
// Used by GetFrameRange to prevent boundary overlap with the previous frame.
func (s *Service) collectEventsAfter(fromTs, toTs string) []decoder.GameEvent {
	events := make([]decoder.GameEvent, 0)

	startIdx := sort.SearchStrings(s.hitTimestamps, fromTs)

	for i := startIdx; i < len(s.hitTimestamps); i++ {
		ts := s.hitTimestamps[i]
		if ts > toTs {
			break
		}
		// Exclusive lower bound: skip events at exactly fromTs
		if ts == fromTs {
			continue
		}
		events = append(events, s.hitEventsByTs[ts]...)
	}

	return events
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

// deduplicatePlayers merges device IDs that belong to the same player
// (identified by sharing a TagText/name) using union-find, and returns
// a mapping from every device ID to its canonical (primary) device ID.
func deduplicatePlayers(db *sql.DB) map[int]int {
	rows, err := db.Query("SELECT SrcIndex, TagText FROM tag WHERE SrcType=1 AND TagText <> ''")
	if err != nil {
		return nil
	}
	defer rows.Close()

	nameDevices := map[string][]int{}
	allDevices := map[int]bool{}
	for rows.Next() {
		var idx int
		var name string
		if err := rows.Scan(&idx, &name); err != nil {
			continue
		}
		nameDevices[name] = append(nameDevices[name], idx)
		allDevices[idx] = true
	}

	parent := map[int]int{}
	for idx := range allDevices {
		parent[idx] = idx
	}
	var find func(int) int
	find = func(x int) int {
		if parent[x] != x {
			parent[x] = find(parent[x])
		}
		return parent[x]
	}
	for _, devices := range nameDevices {
		for i := 1; i < len(devices); i++ {
			ra, rb := find(devices[0]), find(devices[i])
			if ra != rb {
				parent[ra] = rb
			}
		}
	}

	// Map every device to its root.
	canonical := map[int]int{}
	for idx := range allDevices {
		canonical[idx] = find(idx)
	}
	return canonical
}

func buildPlayerList(players map[int]string) []PlayerInfo {
	// Deduplicate: group device IDs by name, keep one entry per unique player.
	nameToIDs := map[string][]int{}
	for id, name := range players {
		nameToIDs[name] = append(nameToIDs[name], id)
	}

	seen := map[string]bool{}
	list := make([]PlayerInfo, 0, len(nameToIDs))
	for name, ids := range nameToIDs {
		if seen[name] {
			continue
		}
		seen[name] = true
		// Use the first (lowest) ID as primary.
		primaryID := ids[0]
		for _, id := range ids[1:] {
			if id < primaryID {
				primaryID = id
			}
		}
		team := "red"
		if primaryID >= 500 {
			team = "blue"
		}
		list = append(list, PlayerInfo{ID: primaryID, Name: name, Team: team})
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
