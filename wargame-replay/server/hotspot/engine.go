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
	Type         string  `json:"type"`      // firefight, killstreak, mass_casualty, engagement, bombardment, long_range
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
	FocusUnitID  int     `json:"focusUnitId,omitempty"`  // star player for killstreak/long_range events
	FocusName    string  `json:"focusName,omitempty"`    // name of the focus unit
	Distance     int     `json:"distance,omitempty"`     // kill distance in metres (for long_range)
	SrcLat       float64 `json:"srcLat,omitempty"`       // shooter position (long_range)
	SrcLng       float64 `json:"srcLng,omitempty"`
	DstLat       float64 `json:"dstLat,omitempty"`       // victim position (long_range)
	DstLng       float64 `json:"dstLng,omitempty"`
}

// ---------- tuning constants ----------

const (
	clusterGapSec   = 45  // seconds of silence before starting a new cluster (was 30)
	maxClusterSec   = 180 // split any cluster longer than this (was 120)
	minClusterScore = 15  // discard clusters below this score (was 4)

	// Per-type minimum requirements
	minKillsFirefight = 2  // firefight must have at least 2 kills
	minStreakKills    = 4  // killstreak requires 4+ kills from one player (was 3)
	minKillsEngage   = 3  // engagement must have at least 3 kills
	maxStreakGapSec   = 60 // max seconds between consecutive kills in a streak

	// Long-range kill detection — sweep from longRangeMaxM down by longRangeStep
	// until a non-empty bucket is found (floor = longRangeMinM). Keep top N.
	longRangeMaxM  = 600  // start scanning from this distance
	longRangeMinM  = 250  // lowest bucket to try before giving up
	longRangeStep  = 50   // bucket step (metres)
	longRangeTopN  = 3    // keep top N kills from the first non-empty bucket
	maxPosAgeSec   = 10   // max seconds a cached position may be stale for distance calc

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

	// Phase 2 — extract killstreaks from FULL clusters (before splitting),
	// then split for non-killstreak types.
	//
	// Why: splitLongCluster cuts at the biggest gap, which can break a true
	// multi-kill streak that spans the gap into two sub-threshold halves.
	// By detecting killstreaks on the unsplit cluster, we preserve them.
	var hotspots []HotspotEvent
	for _, cl := range clusters {
		// Extract all per-player killstreaks from the full cluster
		ksHotspots := extractKillstreaks(cl)
		for i := range ksHotspots {
			if ksHotspots[i].Score < minClusterScore {
				continue
			}
			ksHotspots[i].CenterLat, ksHotspots[i].CenterLng, ksHotspots[i].Radius =
				lookupSpatialInfo(db, resolver, ksHotspots[i].StartTs, ksHotspots[i].EndTs, ksHotspots[i].Units)
			hotspots = append(hotspots, ksHotspots[i])
		}

		// Split and analyse for non-killstreak types (firefight, mass_casualty, engagement)
		for _, subcl := range splitLongCluster(cl, maxClusterSec) {
			h := analyseCluster(subcl)
			if h.Score < minClusterScore {
				continue
			}
			// Killstreaks already extracted above; skip from sub-clusters
			if h.Type == "killstreak" {
				continue
			}
			h.CenterLat, h.CenterLng, h.Radius = lookupSpatialInfo(db, resolver, h.StartTs, h.EndTs, h.Units)
			hotspots = append(hotspots, h)
		}
	}

	// ---- long-range kill hotspots ----
	hotspots = append(hotspots, detectLongRangeKills(db, resolver, combat)...)

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

// ---------- killstreak pre-extraction ----------

// extractKillstreaks detects all per-player kill streaks ≥ minStreakKills from
// a full temporal cluster BEFORE splitting.  This prevents splitLongCluster
// from breaking a true multi-kill run that spans a temporal gap into two
// sub-threshold halves.
//
// A streak breaks when:
//  1. The player dies (appears as victim in a kill event), OR
//  2. More than maxStreakGapSec seconds pass between consecutive kills.
//
// This ensures killstreaks reflect short, intense bursts of kills — not a
// player who survived for 30 minutes with occasional kills.
//
// Returns one HotspotEvent per qualifying player, with time ranges narrowed
// to the streak's actual kills (plus padding).
func extractKillstreaks(events []decoder.GameEvent) []HotspotEvent {
	if len(events) == 0 {
		return nil
	}

	maxGap := time.Duration(maxStreakGapSec) * time.Second

	type streakInfo struct {
		current     int
		best        int
		curVictims  []int
		bestVictims []int
		curTimes    []string // timestamps of kills in current streak
		bestTimes   []string // timestamps of kills in best streak
		lastKillTs  time.Time
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
		if ev.Type != "kill" {
			continue
		}
		evTime, _ := time.Parse(tsLayout, ev.Ts)

		s := getStreak(ev.SrcID)
		// Check time gap: if too long since last kill, reset the streak
		if s.current > 0 && !s.lastKillTs.IsZero() && evTime.Sub(s.lastKillTs) > maxGap {
			s.current = 0
			s.curVictims = nil
			s.curTimes = nil
		}
		s.current++
		s.lastKillTs = evTime
		if ev.DstID != 0 {
			s.curVictims = append(s.curVictims, ev.DstID)
		}
		s.curTimes = append(s.curTimes, ev.Ts)
		// >= to prefer the most recent streak of equal length (better spatial data)
		if s.current >= s.best {
			s.best = s.current
			s.bestVictims = append([]int(nil), s.curVictims...)
			s.bestTimes = append([]string(nil), s.curTimes...)
		}
		// Reset victim's streak (they died)
		if ev.DstID != 0 {
			vs := getStreak(ev.DstID)
			vs.current = 0
			vs.curVictims = nil
			vs.curTimes = nil
			vs.lastKillTs = time.Time{}
		}
	}

	var results []HotspotEvent
	for playerID, s := range streaks {
		if s.best < minStreakKills {
			continue
		}

		// Build unit list: killer + streak victims
		focusSet := map[int]bool{playerID: true}
		for _, vid := range s.bestVictims {
			focusSet[vid] = true
		}
		unitIDs := make([]int, 0, len(focusSet))
		for id := range focusSet {
			unitIDs = append(unitIDs, id)
		}
		sort.Ints(unitIDs)

		// Time range: first kill → last kill in the streak, with padding
		startTs := addSecondsToTs(s.bestTimes[0], -3)
		endTs := addSecondsToTs(s.bestTimes[len(s.bestTimes)-1], 12)
		peakTs := s.bestTimes[len(s.bestTimes)-1]

		// Score: streak quality + unit count
		score := float64(s.best)*3.0 + float64(s.best)*2.5 + float64(len(focusSet))*0.3
		if s.best >= 5 {
			score += float64(s.best) * 1.5
		}

		results = append(results, HotspotEvent{
			Type:        "killstreak",
			StartTs:     startTs,
			EndTs:       endTs,
			PeakTs:      peakTs,
			Score:       score,
			Label:       fmt.Sprintf("连杀 ×%d", s.best),
			Kills:       s.best,
			Units:       unitIDs,
			FocusUnitID: playerID,
			Radius:      100,
		})
	}

	// Deterministic ordering: highest score first, then lowest player ID
	sort.Slice(results, func(i, j int) bool {
		if results[i].Score != results[j].Score {
			return results[i].Score > results[j].Score
		}
		return results[i].FocusUnitID < results[j].FocusUnitID
	})

	return results
}

// ---------- long-range kill detection ----------

// detectLongRangeKills scans all kill events and identifies those where the
// distance between shooter and victim exceeds the minimum threshold.
//
// Strategy:
//  1. Single chronological pass through position frames and kill events,
//     maintaining a timestamped latest-known-position map.  Positions older
//     than maxPosAgeSec are discarded to avoid stale data from dead/respawned
//     units producing false distances.
//  2. Tiered top-N selection: kills are bucketed by distance in longRangeBucket
//     steps (e.g. 150-199m, 200-249m, 250-299m…).  Within each bucket only
//     the top longRangeTopN kills (by distance) are kept, so every distance
//     tier is represented without flooding with lower-distance events.
func detectLongRangeKills(
	db *sql.DB,
	resolver decoder.CoordResolver,
	combatEvents []decoder.GameEvent,
) []HotspotEvent {
	// Filter to kill events with valid src/dst
	var kills []decoder.GameEvent
	for _, e := range combatEvents {
		if e.Type == "kill" && e.SrcID != 0 && e.DstID != 0 {
			kills = append(kills, e)
		}
	}
	if len(kills) == 0 {
		return nil
	}

	startTs := kills[0].Ts
	endTs := kills[len(kills)-1].Ts

	// Query all position frames in the kill time range (with padding for the
	// accumulation window so we have positions before the first kill).
	rows, err := db.Query(`
		SELECT LogTime, LogData FROM record
		WHERE SrcType=1 AND DataType=1
		  AND LogTime >= datetime(?, '-10 seconds')
		  AND LogTime <= datetime(?, '+5 seconds')
		ORDER BY LogTime ASC
	`, startTs, endTs)
	if err != nil {
		return nil
	}
	defer rows.Close()

	// Read all frames into memory with parsed timestamps
	type posFrame struct {
		ts   time.Time
		data []decoder.UnitPosition
	}
	var frames []posFrame
	for rows.Next() {
		var tsStr string
		var blob []byte
		if err := rows.Scan(&tsStr, &blob); err != nil {
			continue
		}
		t, err := time.Parse(tsLayout, tsStr)
		if err != nil {
			continue
		}
		frames = append(frames, posFrame{ts: t, data: decoder.DecodePositionFrame(blob)})
	}

	// Merge pass: iterate through frames and kills in chronological order.
	// Maintain a running latest-known-position map for each unit, WITH
	// timestamps so we can discard stale positions (e.g. a unit that died
	// minutes ago whose position was never updated — using it would produce
	// wildly inaccurate distances).
	type timedPos struct {
		pos geoPoint
		ts  time.Time
	}
	latestPos := make(map[uint16]timedPos)
	fi := 0 // frame index
	maxAge := time.Duration(maxPosAgeSec) * time.Second

	var candidates []HotspotEvent
	for _, kill := range kills {
		killTime, err := time.Parse(tsLayout, kill.Ts)
		if err != nil {
			continue
		}

		// Advance position frames up to the kill time
		for fi < len(frames) && !frames[fi].ts.After(killTime) {
			ft := frames[fi].ts
			for _, u := range frames[fi].data {
				if u.RawLat == 0 && u.RawLng == 0 {
					continue
				}
				lat, lng := resolver.Convert(u.RawLat, u.RawLng)
				if lat != 0 || lng != 0 {
					latestPos[u.ID] = timedPos{geoPoint{lat, lng}, ft}
				}
			}
			fi++
		}

		// Look up positions of shooter and victim — reject stale entries
		srcTp, srcOk := latestPos[uint16(kill.SrcID)]
		dstTp, dstOk := latestPos[uint16(kill.DstID)]
		if !srcOk || !dstOk {
			continue
		}
		if killTime.Sub(srcTp.ts) > maxAge || killTime.Sub(dstTp.ts) > maxAge {
			continue // position too old — likely from a previous life / different location
		}

		dist := haversineDist(srcTp.pos, dstTp.pos)
		if dist < float64(longRangeMinM) {
			continue
		}

		distInt := int(math.Round(dist))

		// Center = midpoint between shooter and victim
		centerLat := (srcTp.pos.lat + dstTp.pos.lat) / 2
		centerLng := (srcTp.pos.lng + dstTp.pos.lng) / 2

		// Radius = half the distance so both units are visible, with 20% padding
		radius := math.Max(60, dist*0.6)

		// Score scales with distance: 150m → 30, 200m → 40, 300m → 60, 500m → 100
		score := dist / 5.0

		candidates = append(candidates, HotspotEvent{
			Type:        "long_range",
			StartTs:     addSecondsToTs(kill.Ts, -5),
			EndTs:       addSecondsToTs(kill.Ts, 25),
			PeakTs:      kill.Ts,
			CenterLat:   centerLat,
			CenterLng:   centerLng,
			Radius:      radius,
			Score:       score,
			Label:       fmt.Sprintf("超远击杀 %dm", distInt),
			Kills:       1,
			Units:       []int{kill.SrcID, kill.DstID},
			FocusUnitID: kill.SrcID,
			Distance:    distInt,
			SrcLat:      srcTp.pos.lat,
			SrcLng:      srcTp.pos.lng,
			DstLat:      dstTp.pos.lat,
			DstLng:      dstTp.pos.lng,
		})
	}

	// --- Descending sweep: find the highest non-empty 50m bucket, keep top N ---
	// Sweep from longRangeMaxM down to longRangeMinM in longRangeStep steps.
	// The first bucket that contains any candidates wins; return its top N.
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].Distance > candidates[j].Distance })

	for floor := longRangeMaxM; floor >= longRangeMinM; floor -= longRangeStep {
		var bucket []HotspotEvent
		for _, h := range candidates {
			if h.Distance >= floor {
				bucket = append(bucket, h)
			}
		}
		if len(bucket) == 0 {
			continue
		}
		// Found a non-empty tier — keep top N (already sorted by distance desc)
		n := longRangeTopN
		if n > len(bucket) {
			n = len(bucket)
		}
		return bucket[:n]
	}

	return nil
}

// ---------- cluster analysis ----------

// analyseCluster classifies a (sub-)cluster into firefight, mass_casualty,
// engagement, or killstreak.  When used in the main pipeline, killstreak
// results from sub-clusters are skipped in favour of extractKillstreaks
// output, but the classification is kept for self-contained correctness.
func analyseCluster(events []decoder.GameEvent) HotspotEvent {
	kills, hits := 0, 0
	allUnits := map[int]bool{}
	tsCounts := map[string]int{}

	// --- True killstreak detection ---
	// A killstreak is an unbroken sequence of kills by one player.
	// The streak resets when:
	//  1. The player appears as a victim (gets killed), OR
	//  2. More than maxStreakGapSec seconds pass between consecutive kills.
	maxGap := time.Duration(maxStreakGapSec) * time.Second

	type streakInfo struct {
		current     int
		best        int
		curVictims  []int
		bestVictims []int
		curTimes    []string
		bestTimes   []string
		totalKills  int
		lastKillTs  time.Time
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
			evTime, _ := time.Parse(tsLayout, ev.Ts)

			// Advance killer's streak
			s := getStreak(ev.SrcID)
			// Check time gap: if too long since last kill, reset the streak
			if s.current > 0 && !s.lastKillTs.IsZero() && evTime.Sub(s.lastKillTs) > maxGap {
				s.current = 0
				s.curVictims = nil
				s.curTimes = nil
			}
			s.current++
			s.totalKills++
			s.lastKillTs = evTime
			if ev.DstID != 0 {
				s.curVictims = append(s.curVictims, ev.DstID)
			}
			s.curTimes = append(s.curTimes, ev.Ts)
			// >= to prefer the most recent streak of equal length
			if s.current >= s.best {
				s.best = s.current
				s.bestVictims = append([]int(nil), s.curVictims...)
				s.bestTimes = append([]string(nil), s.curTimes...)
			}

			// Reset victim's streak (they died)
			if ev.DstID != 0 {
				vs := getStreak(ev.DstID)
				vs.current = 0
				vs.curVictims = nil
				vs.curTimes = nil
				vs.lastKillTs = time.Time{}
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

	// Top kill-streak shooter — deterministic tie-breaking:
	// prefer longer streak, then more total kills, then lower unit ID.
	maxStreak := 0
	topShooterID := 0
	var topShooterVictims []int
	var topShooterTimes []string
	for id, s := range streaks {
		if s.best > maxStreak {
			maxStreak = s.best
			topShooterID = id
			topShooterVictims = s.bestVictims
			topShooterTimes = s.bestTimes
		} else if s.best == maxStreak && maxStreak > 0 {
			topS := streaks[topShooterID]
			if s.totalKills > topS.totalKills || (s.totalKills == topS.totalKills && id < topShooterID) {
				topShooterID = id
				topShooterVictims = s.bestVictims
				topShooterTimes = s.bestTimes
			}
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
	// Note: mass_casualty is checked before killstreak so that when killstreaks
	// are extracted separately (by extractKillstreaks), this function correctly
	// classifies the remaining cluster as mass_casualty rather than killstreak.
	evType := "firefight"
	var label string

	t0, _ := time.Parse(tsLayout, events[0].Ts)
	tN, _ := time.Parse(tsLayout, events[len(events)-1].Ts)
	dur := tN.Sub(t0)

	switch {
	case kills >= 5 && dur < 45*time.Second:
		evType = "mass_casualty"
		label = fmt.Sprintf("大规模伤亡 %d阵亡", kills)
	case maxStreak >= minStreakKills:
		evType = "killstreak"
		label = fmt.Sprintf("连杀 ×%d", maxStreak)
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

	// Pad start/end so the hotspot is visible for a few seconds around the action.
	// For killstreak events, narrow the time range to the streak's kills only.
	startTs := addSecondsToTs(events[0].Ts, -3)
	endTs := addSecondsToTs(events[len(events)-1].Ts, 5)
	if evType == "killstreak" && len(topShooterTimes) > 0 {
		startTs = addSecondsToTs(topShooterTimes[0], -3)
		endTs = addSecondsToTs(topShooterTimes[len(topShooterTimes)-1], 5)
		peakTs = topShooterTimes[len(topShooterTimes)-1]
	}

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
