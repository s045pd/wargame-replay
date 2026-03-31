package hotspot

import (
	"database/sql"
	"fmt"
	"math"
	"sort"
	"time"
	"wargame-replay/server/decoder"
)

const tsLayout = "2006-01-02 15:04:05"

// ---------- HotspotEvent: the single output type ----------

// HotspotEvent is a detected combat hotspot with a time range.
type HotspotEvent struct {
	ID           int     `json:"id"`
	Type         string  `json:"type"`      // firefight, killstreak, mass_casualty, engagement, bombardment
	StartTs      string  `json:"startTs"`
	EndTs        string  `json:"endTs"`
	PeakTs       string  `json:"peakTs"`
	CenterLat    float64 `json:"centerLat"`
	CenterLng    float64 `json:"centerLng"`
	Radius       float64 `json:"radius"` // visual radius, meters
	Score        float64 `json:"score"`
	Label        string  `json:"label"` // Chinese description
	Kills        int     `json:"kills"`
	Hits         int     `json:"hits"`
	Units        []int   `json:"units,omitempty"`
	FocusUnitID  int     `json:"focusUnitId,omitempty"`  // star player for killstreak events
	FocusName    string  `json:"focusName,omitempty"`    // name of the focus unit
}

// ---------- tuning constants ----------

const (
	clusterGapSec   = 45  // seconds of silence before starting a new cluster (was 30)
	maxClusterSec   = 180 // split any cluster longer than this (was 120)
	minClusterScore = 15  // discard clusters below this score (was 4)

	// Per-type minimum requirements
	minKillsFirefight = 2 // firefight must have at least 2 kills
	minStreakKills    = 4 // killstreak requires 4+ kills from one player (was 3)
	minKillsEngage   = 3 // engagement must have at least 3 kills

	// Spatial-temporal dedup: merge hotspots closer than this
	dedupDistMetres = 200.0 // metres
	dedupOverlapSec = 30    // seconds of overlap needed to consider as duplicate
)

// ---------- public API ----------

// DetectHotspotEvents analyses all combat + bombing events and returns a
// sorted list of discrete hotspot events with time ranges, centres, scores
// and Chinese labels.
func DetectHotspotEvents(
	db *sql.DB,
	resolver decoder.CoordResolver,
	combatEvents []decoder.GameEvent,
	bombingEvents []decoder.BombingEvent,
) []HotspotEvent {

	// ---- combat hotspots ----

	// Filter to hit/kill only, already sorted by timestamp from DB.
	var combat []decoder.GameEvent
	for _, e := range combatEvents {
		if e.Type == "hit" || e.Type == "kill" {
			combat = append(combat, e)
		}
	}

	// Phase 1 — temporal clustering
	clusters := temporalCluster(combat)

	// Phase 2 — split overlong clusters
	var split [][]decoder.GameEvent
	for _, cl := range clusters {
		split = append(split, splitLongCluster(cl, maxClusterSec)...)
	}

	// Phase 3 — analyse, score, classify
	var hotspots []HotspotEvent
	for _, cl := range split {
		h := analyseCluster(cl)
		if h.Score < minClusterScore {
			continue
		}
		// Look up spatial centre + real radius from all positions in the time range
		h.CenterLat, h.CenterLng, h.Radius = lookupSpatialInfo(db, resolver, h.StartTs, h.EndTs, h.Units)
		hotspots = append(hotspots, h)
	}

	// ---- bombing hotspots ----
	for _, bev := range bombingEvents {
		if bev.Lat == 0 && bev.Lng == 0 {
			continue
		}
		hotspots = append(hotspots, HotspotEvent{
			Type:      "bombardment",
			StartTs:   addSecondsToTs(bev.Ts, -5),
			EndTs:     addSecondsToTs(bev.Ts, 20),
			PeakTs:    bev.Ts,
			CenterLat: bev.Lat,
			CenterLng: bev.Lng,
			Radius:    300,
			Score:     12,
			Label:     "轰炸/空袭",
		})
	}

	// ---- deduplicate overlapping nearby hotspots ----
	hotspots = deduplicateHotspots(hotspots)

	// ---- sort by start time, assign IDs ----
	sort.Slice(hotspots, func(i, j int) bool { return hotspots[i].StartTs < hotspots[j].StartTs })
	for i := range hotspots {
		hotspots[i].ID = i + 1
	}
	return hotspots
}

// ---------- temporal clustering ----------

func temporalCluster(events []decoder.GameEvent) [][]decoder.GameEvent {
	if len(events) == 0 {
		return nil
	}
	var clusters [][]decoder.GameEvent
	var cur []decoder.GameEvent
	var lastT time.Time

	for _, ev := range events {
		t, err := time.Parse(tsLayout, ev.Ts)
		if err != nil {
			continue
		}
		if len(cur) > 0 && t.Sub(lastT) > time.Duration(clusterGapSec)*time.Second {
			clusters = append(clusters, cur)
			cur = nil
		}
		cur = append(cur, ev)
		lastT = t
	}
	if len(cur) > 0 {
		clusters = append(clusters, cur)
	}
	return clusters
}

// splitLongCluster recursively splits clusters exceeding maxSec at the
// biggest internal gap, producing more digestible segments.
func splitLongCluster(events []decoder.GameEvent, maxSec int) [][]decoder.GameEvent {
	if len(events) <= 1 {
		return [][]decoder.GameEvent{events}
	}
	t0, _ := time.Parse(tsLayout, events[0].Ts)
	tN, _ := time.Parse(tsLayout, events[len(events)-1].Ts)
	if tN.Sub(t0) <= time.Duration(maxSec)*time.Second {
		return [][]decoder.GameEvent{events}
	}

	// Split at the biggest gap
	bestGap := time.Duration(0)
	bestIdx := len(events) / 2
	for i := 1; i < len(events); i++ {
		a, _ := time.Parse(tsLayout, events[i-1].Ts)
		b, _ := time.Parse(tsLayout, events[i].Ts)
		if g := b.Sub(a); g > bestGap {
			bestGap = g
			bestIdx = i
		}
	}

	var out [][]decoder.GameEvent
	out = append(out, splitLongCluster(events[:bestIdx], maxSec)...)
	out = append(out, splitLongCluster(events[bestIdx:], maxSec)...)
	return out
}

// ---------- cluster analysis ----------

func analyseCluster(events []decoder.GameEvent) HotspotEvent {
	kills, hits := 0, 0
	shooterTotalKills := map[int]int{}
	allUnits := map[int]bool{}
	tsCounts := map[string]int{}

	// --- True killstreak detection ---
	// A killstreak is an unbroken sequence of kills by one player.
	// The streak resets when the player appears as a victim (gets killed).
	// Track per-player: current running streak, and their all-time best streak
	// within this cluster, plus the victims during that best streak.
	type streakInfo struct {
		current     int
		best        int
		curVictims  []int // victims in current streak
		bestVictims []int // victims in the best streak
	}
	streaks := map[int]*streakInfo{}

	getStreak := func(id int) *streakInfo {
		s, ok := streaks[id]
		if !ok {
			s = &streakInfo{}
			streaks[id] = s
		}
		return s
	}

	for _, ev := range events {
		if ev.Type == "kill" {
			kills++
			shooterTotalKills[ev.SrcID]++

			// Advance killer's streak
			s := getStreak(ev.SrcID)
			s.current++
			if ev.DstID != 0 {
				s.curVictims = append(s.curVictims, ev.DstID)
			}
			if s.current > s.best {
				s.best = s.current
				// Snapshot current victims as the best streak victims
				s.bestVictims = make([]int, len(s.curVictims))
				copy(s.bestVictims, s.curVictims)
			}

			// Reset victim's streak (they died)
			if ev.DstID != 0 {
				vs := getStreak(ev.DstID)
				vs.current = 0
				vs.curVictims = nil
			}
		} else {
			hits++
		}
		allUnits[ev.SrcID] = true
		if ev.DstID != 0 {
			allUnits[ev.DstID] = true
		}
		tsCounts[ev.Ts]++
	}

	// Peak timestamp (most events in one second)
	peakTs := events[0].Ts
	peakCount := 0
	for ts, c := range tsCounts {
		if c > peakCount {
			peakCount = c
			peakTs = ts
		}
	}

	// Top kill-streak shooter (based on true unbroken streak, not total kills)
	maxStreak := 0
	topShooterID := 0
	var topShooterVictims []int
	for id, s := range streaks {
		if s.best > maxStreak {
			maxStreak = s.best
			topShooterID = id
			topShooterVictims = s.bestVictims
		}
	}

	// --- Score ---
	// Kills dominate, hits and unit count are secondary signals
	score := float64(kills)*3.0 + float64(hits)*0.5 + float64(len(allUnits))*0.3
	if maxStreak >= minStreakKills {
		score += float64(maxStreak) * 2.5
	}
	if kills >= 5 {
		score += float64(kills) * 1.5
	}

	// --- Classify & label ---
	evType := "firefight"
	var label string

	t0, _ := time.Parse(tsLayout, events[0].Ts)
	tN, _ := time.Parse(tsLayout, events[len(events)-1].Ts)
	dur := tN.Sub(t0)

	switch {
	case maxStreak >= minStreakKills:
		evType = "killstreak"
		label = fmt.Sprintf("连杀 ×%d", maxStreak)
	case kills >= 5 && dur < 45*time.Second:
		evType = "mass_casualty"
		label = fmt.Sprintf("大规模伤亡 %d阵亡", kills)
	case len(allUnits) >= 15 && kills >= minKillsEngage:
		evType = "engagement"
		label = fmt.Sprintf("大规模交火 %d人 %d阵亡", len(allUnits), kills)
	default:
		// Firefight must have minimum kills to be worth reporting
		if kills < minKillsFirefight {
			score = 0 // will be filtered by minClusterScore
		}
		label = fmt.Sprintf("交火 %d击杀 %d命中", kills, hits)
	}

	// --- Build the Units list ---
	// For killstreak: only include the killer + their direct victims from the
	// best unbroken streak (focused).
	// For other types: include all participants from the cluster.
	var unitIDs []int

	if evType == "killstreak" && topShooterID != 0 {
		focusSet := map[int]bool{topShooterID: true}
		for _, vid := range topShooterVictims {
			focusSet[vid] = true
		}
		unitIDs = make([]int, 0, len(focusSet))
		for id := range focusSet {
			unitIDs = append(unitIDs, id)
		}
	} else {
		unitIDs = make([]int, 0, len(allUnits))
		for id := range allUnits {
			unitIDs = append(unitIDs, id)
		}
	}
	sort.Ints(unitIDs)

	// Radius will be computed from actual positions in lookupSpatialInfo.
	// Set a default that will be overwritten.
	radius := 100.0

	// Pad start/end so the hotspot is visible for a few seconds around the action
	startTs := addSecondsToTs(events[0].Ts, -3)
	endTs := addSecondsToTs(events[len(events)-1].Ts, 5)

	h := HotspotEvent{
		Type:    evType,
		StartTs: startTs,
		EndTs:   endTs,
		PeakTs:  peakTs,
		Score:   score,
		Label:   label,
		Kills:   kills,
		Hits:    hits,
		Units:   unitIDs,
		Radius:  radius,
	}
	// For killstreak events, record the star player
	if evType == "killstreak" && topShooterID != 0 {
		h.FocusUnitID = topShooterID
	}
	return h
}

// ---------- spatial-temporal deduplication ----------

// deduplicateHotspots removes lower-scoring hotspots that overlap in both
// time and space with a higher-scoring one.  Two hotspots are considered
// duplicates if they overlap by at least dedupOverlapSec seconds AND their
// centres are within dedupDistMetres.  The one with the lower score is removed.
func deduplicateHotspots(hotspots []HotspotEvent) []HotspotEvent {
	if len(hotspots) <= 1 {
		return hotspots
	}

	// Sort by score descending — higher scores survive
	sort.Slice(hotspots, func(i, j int) bool { return hotspots[i].Score > hotspots[j].Score })

	keep := make([]bool, len(hotspots))
	for i := range keep {
		keep[i] = true
	}

	for i := 0; i < len(hotspots); i++ {
		if !keep[i] {
			continue
		}
		for j := i + 1; j < len(hotspots); j++ {
			if !keep[j] {
				continue
			}
			if hotspotOverlaps(hotspots[i], hotspots[j]) {
				keep[j] = false // remove the lower-scored duplicate
			}
		}
	}

	var out []HotspotEvent
	for i, h := range hotspots {
		if keep[i] {
			out = append(out, h)
		}
	}
	return out
}

// hotspotOverlaps returns true if two hotspots overlap temporally and are
// spatially close enough to be considered the same combat event.
func hotspotOverlaps(a, b HotspotEvent) bool {
	// Temporal overlap check
	aStart, _ := time.Parse(tsLayout, a.StartTs)
	aEnd, _ := time.Parse(tsLayout, a.EndTs)
	bStart, _ := time.Parse(tsLayout, b.StartTs)
	bEnd, _ := time.Parse(tsLayout, b.EndTs)

	// Overlap duration
	overlapStart := aStart
	if bStart.After(overlapStart) {
		overlapStart = bStart
	}
	overlapEnd := aEnd
	if bEnd.Before(overlapEnd) {
		overlapEnd = bEnd
	}

	if overlapEnd.Before(overlapStart) {
		return false // no temporal overlap at all
	}
	overlapDur := overlapEnd.Sub(overlapStart)
	if overlapDur < time.Duration(dedupOverlapSec)*time.Second {
		return false // overlap too brief
	}

	// Spatial distance check
	if a.CenterLat == 0 || b.CenterLat == 0 {
		return false
	}
	dist := haversineDist(
		geoPoint{a.CenterLat, a.CenterLng},
		geoPoint{b.CenterLat, b.CenterLng},
	)
	return dist <= dedupDistMetres
}

// ---------- position lookup ----------

// geoPoint is a resolved WGS-84 position.
type geoPoint struct {
	lat, lng float64
}

// haversineDist returns the distance in metres between two WGS-84 points.
func haversineDist(a, b geoPoint) float64 {
	const R = 6371000 // Earth radius in metres
	dLat := (b.lat - a.lat) * math.Pi / 180
	dLng := (b.lng - a.lng) * math.Pi / 180
	lat1 := a.lat * math.Pi / 180
	lat2 := b.lat * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * R * math.Asin(math.Sqrt(h))
}

// densityCenter computes the combat-density-weighted centre of a point set.
//
// Algorithm:
//  1. For each point, count how many other points lie within densityRadius (neighbour count).
//  2. The point with the highest count is the "density peak" — the core of the fighting.
//  3. Collect all points within clusterRadius of that peak.
//  4. Return the centroid of that dense sub-cluster.
//
// This avoids placing the centre in empty terrain between two separated groups.
func densityCenter(pts []geoPoint) (float64, float64) {
	if len(pts) == 0 {
		return 0, 0
	}
	if len(pts) == 1 {
		return pts[0].lat, pts[0].lng
	}
	if len(pts) == 2 {
		return (pts[0].lat + pts[1].lat) / 2, (pts[0].lng + pts[1].lng) / 2
	}

	const densityRadius = 150.0 // metres — neighbourhood for counting density
	const clusterRadius = 200.0 // metres — gather points around the densest spot

	// Step 1 & 2: find the point with the most neighbours within densityRadius
	bestIdx := 0
	bestCount := -1
	for i := range pts {
		count := 0
		for j := range pts {
			if i == j {
				continue
			}
			if haversineDist(pts[i], pts[j]) <= densityRadius {
				count++
			}
		}
		if count > bestCount {
			bestCount = count
			bestIdx = i
		}
	}

	peak := pts[bestIdx]

	// Step 3: gather all points within clusterRadius of the density peak
	var sumLat, sumLng float64
	var cnt int
	for _, p := range pts {
		if haversineDist(peak, p) <= clusterRadius {
			sumLat += p.lat
			sumLng += p.lng
			cnt++
		}
	}
	if cnt == 0 {
		return peak.lat, peak.lng
	}

	// Step 4: centroid of the dense sub-cluster
	return sumLat / float64(cnt), sumLng / float64(cnt)
}

// lookupSpatialInfo queries ALL position frames across the hotspot's full time
// range to collect every position of every involved unit.  Returns the density-
// weighted center and the actual bounding radius (in metres) that encompasses
// all observed positions around that center.
//
// This gives a realistic "combat footprint" based on where units actually moved,
// shot, and fought — not just a snapshot at peak time.
func lookupSpatialInfo(
	db *sql.DB,
	resolver decoder.CoordResolver,
	startTs, endTs string,
	unitIDs []int,
) (centerLat, centerLng, radiusM float64) {
	if len(unitIDs) == 0 {
		return 0, 0, 100
	}
	idSet := make(map[uint16]bool, len(unitIDs))
	for _, id := range unitIDs {
		idSet[uint16(id)] = true
	}

	// Query all position frames within the hotspot time range (with a small pad)
	rows, err := db.Query(`
		SELECT LogData FROM record
		WHERE SrcType=1 AND DataType=1
		  AND LogTime >= datetime(?, '-5 seconds')
		  AND LogTime <= datetime(?, '+5 seconds')
		ORDER BY LogTime ASC
	`, startTs, endTs)
	if err != nil {
		return 0, 0, 100
	}
	defer rows.Close()

	// Collect ALL positions of involved units across the time range.
	// Use a set keyed by (unitID, roundedLat, roundedLng) to deduplicate
	// near-identical positions from consecutive frames.
	type posKey struct {
		id         uint16
		latBucket  int32
		lngBucket  int32
	}
	seen := map[posKey]bool{}
	var pts []geoPoint

	for rows.Next() {
		var blob []byte
		if err := rows.Scan(&blob); err != nil {
			continue
		}
		for _, u := range decoder.DecodePositionFrame(blob) {
			if !idSet[u.ID] || u.RawLat == 0 || u.RawLng == 0 {
				continue
			}
			lat, lng := resolver.Convert(u.RawLat, u.RawLng)
			if lat == 0 && lng == 0 {
				continue
			}
			// Bucket to ~10m grid to avoid duplicate near-identical points
			key := posKey{u.ID, int32(lat * 10000), int32(lng * 10000)}
			if seen[key] {
				continue
			}
			seen[key] = true
			pts = append(pts, geoPoint{lat, lng})
		}
	}

	if len(pts) == 0 {
		return 0, 0, 100
	}

	// Compute density-weighted center
	cLat, cLng := densityCenter(pts)
	if cLat == 0 && cLng == 0 {
		return 0, 0, 100
	}

	// Compute radius using the 80th percentile distance from center.
	// This excludes outlier units at the periphery that inflate the circle,
	// giving a tighter view focused on the core combat area.
	center := geoPoint{cLat, cLng}
	dists := make([]float64, 0, len(pts))
	for _, p := range pts {
		dists = append(dists, haversineDist(center, p))
	}
	sort.Float64s(dists)

	// P80 index: covers 80% of observed positions
	p80Idx := int(float64(len(dists)-1) * 0.80)
	p80Dist := dists[p80Idx]

	// Add 15% padding, with minimum 40m and cap at 400m
	radiusM = math.Max(40, math.Min(400, p80Dist*1.15))

	return cLat, cLng, radiusM
}

// ---------- helpers ----------

func addSecondsToTs(ts string, sec int) string {
	t, err := time.Parse(tsLayout, ts)
	if err != nil {
		return ts
	}
	return t.Add(time.Duration(sec) * time.Second).Format(tsLayout)
}
