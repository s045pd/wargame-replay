package video

import (
	"testing"
	"time"
)

func TestParseGameTsUnixMsUTC(t *testing.T) {
	loc, _ := time.LoadLocation("UTC")
	ms, err := ParseGameTsUnixMs("2026-01-17 11:40:00", loc)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 1, 17, 11, 40, 0, 0, time.UTC).UnixMilli()
	if ms != want {
		t.Errorf("got %d, want %d", ms, want)
	}
}

func TestParseGameTsUnixMsLocal(t *testing.T) {
	ms, err := ParseGameTsUnixMs("2026-03-28 12:15:07", time.Local)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 3, 28, 12, 15, 7, 0, time.Local).UnixMilli()
	if ms != want {
		t.Errorf("got %d, want %d", ms, want)
	}
}

func TestParseGameTsUnixMsInvalid(t *testing.T) {
	cases := []string{"", "not a time", "2026-13-40 99:99:99", "2026/01/17"}
	for _, tc := range cases {
		if _, err := ParseGameTsUnixMs(tc, time.UTC); err == nil {
			t.Errorf("expected error for %q", tc)
		}
	}
}

func TestFormatGameTsRoundtrip(t *testing.T) {
	loc := time.UTC
	in := "2026-04-10 14:23:11"
	ms, err := ParseGameTsUnixMs(in, loc)
	if err != nil {
		t.Fatal(err)
	}
	got := FormatGameTs(ms, loc)
	if got != in {
		t.Errorf("roundtrip: got %q, want %q", got, in)
	}
}

func segWithStart(start time.Time, durationMs int64) VideoSegment {
	return VideoSegment{StartTs: start, DurationMs: durationMs, Codec: "h264", Compatible: true}
}

func TestFindSegmentEmpty(t *testing.T) {
	seg, i := FindSegment(nil, 1000)
	if seg != nil || i != -1 {
		t.Errorf("nil input: got (%v, %d)", seg, i)
	}
}

func TestFindSegmentInside(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z").UnixMilli()
	segs := []VideoSegment{
		segWithStart(time.UnixMilli(base), 60000),
		segWithStart(time.UnixMilli(base+60000), 60000),
	}
	seg, i := FindSegment(segs, base+30000)
	if seg == nil || i != 0 {
		t.Fatalf("got (%v, %d)", seg, i)
	}
	seg, i = FindSegment(segs, base+90000)
	if seg == nil || i != 1 {
		t.Fatalf("got (%v, %d)", seg, i)
	}
}

func TestFindSegmentBoundary(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z").UnixMilli()
	segs := []VideoSegment{
		segWithStart(time.UnixMilli(base), 60000),
		segWithStart(time.UnixMilli(base+60000), 60000),
	}
	// Exact start is inclusive.
	seg, i := FindSegment(segs, base)
	if seg == nil || i != 0 {
		t.Errorf("start boundary: got (%v, %d)", seg, i)
	}
	// Exact end is exclusive -> falls into the next segment.
	seg, i = FindSegment(segs, base+60000)
	if seg == nil || i != 1 {
		t.Errorf("end boundary: got (%v, %d)", seg, i)
	}
	// Past the last segment's end -> nil.
	seg, i = FindSegment(segs, base+120000)
	if seg != nil || i != -1 {
		t.Errorf("past end: got (%v, %d)", seg, i)
	}
	// Before the first segment's start -> nil.
	seg, i = FindSegment(segs, base-1)
	if seg != nil || i != -1 {
		t.Errorf("before start: got (%v, %d)", seg, i)
	}
}

func TestFindSegmentGap(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z").UnixMilli()
	segs := []VideoSegment{
		segWithStart(time.UnixMilli(base), 60000),
		// Gap between 60000 and 70000
		segWithStart(time.UnixMilli(base+70000), 60000),
	}
	seg, i := FindSegment(segs, base+65000)
	if seg != nil || i != -1 {
		t.Errorf("gap: got (%v, %d)", seg, i)
	}
}

func TestCalcOffsetMs(t *testing.T) {
	// offset = game - video.
	if got := CalcOffsetMs(1000, 500); got != 500 {
		t.Errorf("got %d", got)
	}
	if got := CalcOffsetMs(500, 1000); got != -500 {
		t.Errorf("got %d", got)
	}
	if got := CalcOffsetMs(0, 0); got != 0 {
		t.Errorf("got %d", got)
	}
}

func TestSegmentStartMs(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T12:00:00Z")
	s := VideoSegment{StartTs: base}
	if SegmentStartMs(s) != base.UnixMilli() {
		t.Errorf("got %d, want %d", SegmentStartMs(s), base.UnixMilli())
	}
}
