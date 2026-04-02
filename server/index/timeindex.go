package index

import (
	"database/sql"
	"sort"
)

type TimeIndex struct {
	timestamps []string
	rowIDs     []int64
}

func BuildTimeIndex(db *sql.DB) (*TimeIndex, error) {
	rows, err := db.Query(`
		SELECT DISTINCT LogTime, MIN(ID)
		FROM record
		WHERE SrcType=1 AND DataType=1
		GROUP BY LogTime
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	idx := &TimeIndex{}
	for rows.Next() {
		var ts string
		var rowID int64
		if err := rows.Scan(&ts, &rowID); err != nil {
			continue
		}
		idx.timestamps = append(idx.timestamps, ts)
		idx.rowIDs = append(idx.rowIDs, rowID)
	}
	return idx, nil
}

func (idx *TimeIndex) Len() int {
	return len(idx.timestamps)
}

func (idx *TimeIndex) StartTime() string {
	if len(idx.timestamps) == 0 {
		return ""
	}
	return idx.timestamps[0]
}

func (idx *TimeIndex) EndTime() string {
	if len(idx.timestamps) == 0 {
		return ""
	}
	return idx.timestamps[len(idx.timestamps)-1]
}

func (idx *TimeIndex) Lookup(ts string) (int64, bool) {
	if len(idx.timestamps) == 0 {
		return 0, false
	}
	i := sort.SearchStrings(idx.timestamps, ts)
	// Clamp to valid range — Lookup finds the nearest timestamp
	if i >= len(idx.timestamps) {
		i = len(idx.timestamps) - 1
	}
	return idx.rowIDs[i], true
}

// TimestampAt returns the timestamp at the given index offset.
func (idx *TimeIndex) TimestampAt(offset int) (string, bool) {
	if offset < 0 || offset >= len(idx.timestamps) {
		return "", false
	}
	return idx.timestamps[offset], true
}

// IndexOf returns the index of the closest timestamp.
func (idx *TimeIndex) IndexOf(ts string) int {
	i := sort.SearchStrings(idx.timestamps, ts)
	if i >= len(idx.timestamps) {
		return len(idx.timestamps) - 1
	}
	return i
}
