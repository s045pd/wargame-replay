package decoder

import (
	"database/sql"
	"encoding/binary"
)

// LoadAllEvents reads DataType=5 (scoreboard) records and DataType=2 (hit/kill/revive/heal) records.
func LoadAllEvents(db *sql.DB) ([]GameEvent, error) {
	var events []GameEvent

	// DataType=2: Combat events — hit, kill, revive, heal/zone-damage
	hitEvents, err := LoadHitEvents(db)
	if err != nil {
		return nil, err
	}
	events = append(events, hitEvents...)

	return events, nil
}

// LoadHitEvents reads DataType=2, SrcType=1 records which track combat events.
//
// Three event sub-types based on first byte:
//   - 0x01 (4 bytes): Hit/Kill — [0x01] [HP] [shooterID_lo] [shooterID_hi]
//   - 0x40 (2 bytes): System HP change — [0x40] [HP] (medic heal or zone damage, no shooter)
//   - 0x41 (2 bytes): Mass Revive — [0x41] [HP] (batch revive, no shooter)
func LoadHitEvents(db *sql.DB) ([]GameEvent, error) {
	rows, err := db.Query(`
		SELECT SrcIndex, LogTime, LogData FROM record
		WHERE SrcType=1 AND DataType=2 AND LogData IS NOT NULL AND length(LogData) >= 2
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
		if len(blob) < 2 {
			continue
		}

		eventType := blob[0]
		hp := int(blob[1])

		switch eventType {
		case 0x01:
			// Hit/Kill event — needs 4 bytes for shooter ID
			if len(blob) < 4 {
				continue
			}
			shooterID := int(binary.LittleEndian.Uint16(blob[2:4]))
			if hp == 0 {
				events = append(events, GameEvent{
					Type:  "kill",
					Ts:    ts,
					SrcID: shooterID,
					DstID: victimID,
					HP:    0,
				})
			} else {
				events = append(events, GameEvent{
					Type:  "hit",
					Ts:    ts,
					SrcID: shooterID,
					DstID: victimID,
					HP:    hp,
				})
			}

		case 0x41:
			// Mass Revive — unit revived (batch event)
			// HP byte: post-revive HP (may be 0x00 in some DBs, 0x32=50 in others)
			reviveHP := hp
			if reviveHP == 0 {
				reviveHP = 100 // default full HP on revive if not specified
			}
			events = append(events, GameEvent{
				Type:  "revive",
				Ts:    ts,
				SrcID: victimID, // revived unit is both src and dst
				DstID: victimID,
				HP:    reviveHP,
			})

		case 0x40:
			// System HP change — no shooter (medic heal or zone damage)
			events = append(events, GameEvent{
				Type:  "heal",
				Ts:    ts,
				SrcID: victimID, // no shooter, use self
				DstID: victimID,
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
func ComputeBaseCamps(db *sql.DB, resolver CoordResolver) []BaseCamp {
	var firstTs string
	err := db.QueryRow(`
		SELECT MIN(LogTime) FROM record WHERE SrcType=1 AND DataType=1
	`).Scan(&firstTs)
	if err != nil || firstTs == "" {
		return nil
	}

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
			if acc, ok := teams[u.Team]; ok {
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
