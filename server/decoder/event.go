package decoder

import (
	"database/sql"
	"encoding/binary"
)

// LoadAllEvents reads DataType=5 (kill/hit) records and attempts to decode them.
func LoadAllEvents(db *sql.DB) ([]GameEvent, error) {
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
		if len(blob) < 16 {
			continue
		}
		ev := decodeKillBlob(ts, blob)
		events = append(events, ev...)
	}
	return events, nil
}

func decodeKillBlob(ts string, blob []byte) []GameEvent {
	if len(blob) < 8 {
		return nil
	}
	teamAScore := binary.LittleEndian.Uint32(blob[0:4])
	teamBScore := binary.LittleEndian.Uint32(blob[4:8])

	var events []GameEvent
	if teamAScore > 0 || teamBScore > 0 {
		events = append(events, GameEvent{
			Type:   "score_update",
			Ts:     ts,
			SrcID:  int(teamAScore),
			DstID:  int(teamBScore),
			Detail: "cumulative team scores",
		})
	}
	return events
}

// LoadStatusEvents reads DataType=2 (status change) records
func LoadStatusEvents(db *sql.DB) ([]GameEvent, error) {
	rows, err := db.Query(`
		SELECT SrcIndex, LogTime, LocLat, LocLng, LogData FROM record
		WHERE DataType=2 AND LogData IS NOT NULL
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []GameEvent
	for rows.Next() {
		var srcIdx int
		var ts string
		var lat, lng int64
		var blob []byte
		if err := rows.Scan(&srcIdx, &ts, &lat, &lng, &blob); err != nil {
			continue
		}
		events = append(events, GameEvent{
			Type:  "status",
			Ts:    ts,
			SrcID: srcIdx,
		})
	}
	return events, nil
}
