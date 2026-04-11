package video

import (
	"testing"
	"time"
)

func TestAnnotateStale_AllFresh(t *testing.T) {
	base := mustParseTs(t, "2026-03-28T04:00:00Z")
	mtime := time.Unix(1000, 0).UTC()

	idx := NewIndex()
	idx.Replace([]IndexEntry{
		{RelPath: "a.mp4", StartTs: base, DurationMs: 1000, Codec: "h264", FileMTime: mtime},
		{RelPath: "b.mp4", StartTs: base, DurationMs: 1000, Codec: "h264", FileMTime: mtime},
	})

	groups := []VideoGroup{{
		ID: "g1",
		Segments: []VideoSegment{
			{RelPath: "a.mp4", FileMTime: mtime, StartTs: base},
			{RelPath: "b.mp4", FileMTime: mtime, StartTs: base},
		},
	}}
	idx.AnnotateStale(groups)
	for _, seg := range groups[0].Segments {
		if seg.Stale {
			t.Errorf("%s should be fresh", seg.RelPath)
		}
	}
}

func TestAnnotateStale_MissingFromIndex(t *testing.T) {
	base := mustParseTs(t, "2026-03-28T04:00:00Z")
	idx := NewIndex() // empty

	groups := []VideoGroup{{
		ID: "g1",
		Segments: []VideoSegment{
			{RelPath: "gone.mp4", FileMTime: time.Unix(1000, 0).UTC(), StartTs: base},
		},
	}}
	idx.AnnotateStale(groups)
	if !groups[0].Segments[0].Stale {
		t.Errorf("missing segment should be stale")
	}
}

func TestAnnotateStale_MtimeChanged(t *testing.T) {
	base := mustParseTs(t, "2026-03-28T04:00:00Z")
	oldMtime := time.Unix(1000, 0).UTC()
	newMtime := time.Unix(2000, 0).UTC()

	idx := NewIndex()
	idx.Replace([]IndexEntry{
		{RelPath: "a.mp4", StartTs: base, DurationMs: 1000, Codec: "h264", FileMTime: newMtime},
	})

	groups := []VideoGroup{{
		ID: "g1",
		Segments: []VideoSegment{
			{RelPath: "a.mp4", FileMTime: oldMtime, StartTs: base},
		},
	}}
	idx.AnnotateStale(groups)
	if !groups[0].Segments[0].Stale {
		t.Errorf("mtime-changed segment should be stale")
	}
}

func TestAnnotateStale_MixedInGroup(t *testing.T) {
	base := mustParseTs(t, "2026-03-28T04:00:00Z")
	mtime := time.Unix(1000, 0).UTC()

	idx := NewIndex()
	idx.Replace([]IndexEntry{
		{RelPath: "a.mp4", StartTs: base, DurationMs: 1000, Codec: "h264", FileMTime: mtime},
	})

	groups := []VideoGroup{{
		ID: "g1",
		Segments: []VideoSegment{
			{RelPath: "a.mp4", FileMTime: mtime, StartTs: base},
			{RelPath: "gone.mp4", FileMTime: mtime, StartTs: base},
		},
	}}
	idx.AnnotateStale(groups)
	if groups[0].Segments[0].Stale {
		t.Errorf("segment 0 should be fresh")
	}
	if !groups[0].Segments[1].Stale {
		t.Errorf("segment 1 should be stale")
	}
}

func TestAnnotateStale_MultipleGroups(t *testing.T) {
	base := mustParseTs(t, "2026-03-28T04:00:00Z")
	mtime := time.Unix(1000, 0).UTC()
	idx := NewIndex()
	idx.Replace([]IndexEntry{
		{RelPath: "a.mp4", StartTs: base, DurationMs: 1000, Codec: "h264", FileMTime: mtime},
	})

	groups := []VideoGroup{
		{ID: "g1", Segments: []VideoSegment{{RelPath: "a.mp4", FileMTime: mtime, StartTs: base}}},
		{ID: "g2", Segments: []VideoSegment{{RelPath: "b.mp4", FileMTime: mtime, StartTs: base}}},
	}
	idx.AnnotateStale(groups)
	if groups[0].Segments[0].Stale {
		t.Errorf("g1 should be fresh")
	}
	if !groups[1].Segments[0].Stale {
		t.Errorf("g2 should be stale")
	}
}
