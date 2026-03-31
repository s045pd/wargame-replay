package decoder

import (
	"database/sql"
	"encoding/binary"
)

// LoadAllEvents reads DataType=5 (scoreboard) records and DataType=2 (hit/kill) records.
func LoadAllEvents(db *sql.DB) ([]GameEvent, error) {
	var events []GameEvent

	// DataType=2: Hit events — per-player damage records
	// Format: [0x01] [HP remaining: 0-80] [ShooterID uint16LE]
	hitEvents, err := LoadHitEvents(db)
	if err != nil {
		return nil, err
	}
	events = append(events, hitEvents...)

	return events, nil
}

// LoadHitEvents reads DataType=2 records which track individual hit/kill events.
// Each record: SrcIndex = victim, LogData = [0x01, HP, shooterID_lo, shooterID_hi]
func LoadHitEvents(db *sql.DB) ([]GameEvent, error) {
	rows, err := db.Query(`
		SELECT SrcIndex, LogTime, LogData FROM record
		WHERE SrcType=1 AND DataType=2 AND LogData IS NOT NULL AND length(LogData) >= 4
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []GameEvent
	for rows.Next() {
		var victimID int
		var ts string
		var blob []byte
		if err := rows.Scan(&victimID, &ts, &blob); err != nil {
			continue
		}
		if len(blob) < 4 {
			continue
		}

		hp := int(blob[1])
		shooterID := int(binary.LittleEndian.Uint16(blob[2:4]))

		if hp == 0 {
			// Kill event — HP dropped to 0
			events = append(events, GameEvent{
				Type:  "kill",
				Ts:    ts,
				SrcID: shooterID, // killer
				DstID: victimID,  // victim
				HP:    0,
			})
		} else {
			// Hit event — damage taken
			events = append(events, GameEvent{
				Type:  "hit",
				Ts:    ts,
				SrcID: shooterID, // shooter
				DstID: victimID,  // victim
				HP:    hp,
			})
		}
	}
	return events, nil
}

// BombingEvent represents a DataType=11 battlefield event (bombing, airdrop, etc.)
type BombingEvent struct {
	Ts      string  `json:"ts"`
	RawLat  uint32  `json:"-"`
	RawLng  uint32  `json:"-"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
	Param   int     `json:"param"`   // first byte of LogData (e.g. radius)
	EvType  int     `json:"evType"`  // third byte — event type
	SubType int     `json:"subType"` // fourth byte — event sub-type
}

// LoadBombingEvents reads DataType=11 records which represent bombing/special battlefield events.
// Each record: LocLat/LocLng = raw coordinates, LogData = [param, 0, type, subtype]
func LoadBombingEvents(db *sql.DB) ([]BombingEvent, error) {
	rows, err := db.Query(`
		SELECT LocLat, LocLng, LogTime, LogData FROM record
		WHERE DataType=11 AND LogData IS NOT NULL
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []BombingEvent
	for rows.Next() {
		var rawLat, rawLng uint32
		var ts string
		var blob []byte
		if err := rows.Scan(&rawLat, &rawLng, &ts, &blob); err != nil {
			continue
		}
		ev := BombingEvent{
			Ts:     ts,
			RawLat: rawLat,
			RawLng: rawLng,
		}
		if len(blob) >= 4 {
			ev.Param = int(blob[0])
			ev.EvType = int(blob[2])
			ev.SubType = int(blob[3])
		}
		events = append(events, ev)
	}
	return events, nil
}

// BaseCamp represents a team's starting position (centroid of earliest positions).
type BaseCamp struct {
	Team string  `json:"team"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

// ComputeBaseCamps finds team spawn positions from the earliest position frame.
// It takes the centroid of each team's unit positions from the first few seconds.
func ComputeBaseCamps(db *sql.DB, resolver CoordResolver) []BaseCamp {
	// Get the earliest timestamp
	var firstTs string
	err := db.QueryRow(`
		SELECT MIN(LogTime) FROM record WHERE SrcType=1 AND DataType=1
	`).Scan(&firstTs)
	if err != nil || firstTs == "" {
		return nil
	}

	// Get positions from the first 10 seconds to collect all units
	rows, err := db.Query(`
		SELECT LogData FROM record
		WHERE SrcType=1 AND DataType=1
		  AND LogTime >= ? AND LogTime <= datetime(?, '+10 seconds')
		ORDER BY LogTime ASC
	`, firstTs, firstTs)
	if err != nil {
		return nil
	}
	defer rows.Close()

	type teamAccum struct {
		sumLat, sumLng float64
		count          int
	}
	teams := map[string]*teamAccum{
		"red":  {},
		"blue": {},
	}

	seen := make(map[uint16]bool)

	for rows.Next() {
		var blob []byte
		if err := rows.Scan(&blob); err != nil {
			continue
		}
		for _, u := range DecodePositionFrame(blob) {
			if u.RawLat == 0 && u.RawLng == 0 {
				continue
			}
			if seen[u.ID] {
				continue
			}
			seen[u.ID] = true

			lat, lng := resolver.Convert(u.RawLat, u.RawLng)
			if lat < -90 || lat > 90 || lng < -180 || lng > 180 {
				continue
			}
			team := u.Team
			if acc, ok := teams[team]; ok {
				acc.sumLat += lat
				acc.sumLng += lng
				acc.count++
			}
		}
	}

	var camps []BaseCamp
	for team, acc := range teams {
		if acc.count > 0 {
			camps = append(camps, BaseCamp{
				Team: team,
				Lat:  acc.sumLat / float64(acc.count),
				Lng:  acc.sumLng / float64(acc.count),
			})
		}
	}
	return camps
}

// LoadScoreUpdates reads DataType=5 (scoreboard) records.
// 224 bytes per record, tracking cumulative team kill counts.
func LoadScoreUpdates(db *sql.DB) ([]GameEvent, error) {
	rows, err := db.Query(`
		SELECT LogTime, LogData FROM record
		WHERE SrcType=64 AND DataType=5 AND LogData IS NOT NULL
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []GameEvent
	for rows.Next() {
		var ts string
		var blob []byte
		if err := rows.Scan(&ts, &blob); err != nil {
			continue
		}
		if len(blob) < 8 {
			continue
		}
		redKills := binary.LittleEndian.Uint32(blob[0:4])
		blueKills := binary.LittleEndian.Uint32(blob[4:8])

		events = append(events, GameEvent{
			Type:  "score_update",
			Ts:    ts,
			SrcID: int(redKills),
			DstID: int(blueKills),
		})
	}
	return events, nil
}
