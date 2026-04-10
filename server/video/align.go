package video

import (
	"fmt"
	"time"
)

// gameTsLayout matches the string format produced by scanner.formatTimestamp
// ("2026-01-17 11:40:00"). There is no timezone suffix, so the caller must
// supply one explicitly (usually time.Local).
const gameTsLayout = "2006-01-02 15:04:05"

// ParseGameTsUnixMs parses the "YYYY-MM-DD HH:MM:SS" timestamps that the game
// service emits and returns Unix milliseconds.
//
// Game timestamps come from SQLite LogTime strings — they have no explicit
// timezone, so loc must be supplied explicitly. Passing time.Local matches
// how scanner.go / timeindex.go interpret them.
func ParseGameTsUnixMs(ts string, loc *time.Location) (int64, error) {
	if loc == nil {
		loc = time.Local
	}
	t, err := time.ParseInLocation(gameTsLayout, ts, loc)
	if err != nil {
		return 0, fmt.Errorf("parse game ts %q: %w", ts, err)
	}
	return t.UnixMilli(), nil
}

// FormatGameTs formats a Unix ms value back into the game timestamp string
// using loc. Primarily used for test fixtures and debug logging.
func FormatGameTs(unixMs int64, loc *time.Location) string {
	if loc == nil {
		loc = time.Local
	}
	return time.UnixMilli(unixMs).In(loc).Format(gameTsLayout)
}

// SegmentStartMs returns seg.StartTs in Unix milliseconds.
func SegmentStartMs(seg VideoSegment) int64 {
	return seg.StartTs.UnixMilli()
}

// FindSegment returns the segment that contains videoMs, plus its index in
// the slice. Returns (nil, -1) if videoMs is before the first segment, after
// the last, or inside a gap.
//
// segments must be sorted ascending by StartTs.
func FindSegment(segments []VideoSegment, videoMs int64) (*VideoSegment, int) {
	if len(segments) == 0 {
		return nil, -1
	}
	// Linear scan is fine because segments for one group rarely exceed a few
	// dozen entries, and callers use this in a hot playback loop where
	// branch-free simplicity beats algorithmic cleverness.
	for i := range segments {
		s := &segments[i]
		start := SegmentStartMs(*s)
		end := start + s.DurationMs
		if videoMs >= start && videoMs < end {
			return s, i
		}
	}
	return nil, -1
}

// CalcOffsetMs returns the offset that makes videoMs align with gameMs, using
// the convention gameMs = videoMs + offsetMs.
func CalcOffsetMs(gameMs, videoMs int64) int64 {
	return gameMs - videoMs
}
