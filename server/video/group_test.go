package video

import (
	"testing"
	"time"
)

func entryFull(relPath string, start time.Time, durationMs int64, codec string, w, h int) IndexEntry {
	return IndexEntry{
		RelPath:    relPath,
		StartTs:    start,
		DurationMs: durationMs,
		Codec:      codec,
		Width:      w,
		Height:     h,
	}
}

func TestAutoGroupEmpty(t *testing.T) {
	if g := AutoGroup(nil); g != nil {
		t.Errorf("nil input should give nil, got %v", g)
	}
	if g := AutoGroup([]IndexEntry{}); g != nil {
		t.Errorf("empty input should give nil, got %v", g)
	}
}

func TestAutoGroupSingle(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	g := AutoGroup([]IndexEntry{
		entryFull("dir/GX010001.mp4", base, 60000, "h264", 1920, 1080),
	})
	if len(g) != 1 {
		t.Fatalf("want 1 group, got %d", len(g))
	}
	if len(g[0].Segments) != 1 {
		t.Errorf("want 1 segment, got %d", len(g[0].Segments))
	}
	if !g[0].Compatible {
		t.Errorf("h264 should be compatible")
	}
}

func TestAutoGroupContinuous(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entryFull("dir/GX010001.mp4", base, 60000, "h264", 1920, 1080),
		entryFull("dir/GX010002.mp4", base.Add(60*time.Second), 60000, "h264", 1920, 1080),
		entryFull("dir/GX010003.mp4", base.Add(120*time.Second+500*time.Millisecond), 60000, "h264", 1920, 1080),
	}
	g := AutoGroup(entries)
	if len(g) != 1 {
		t.Fatalf("want 1 group (continuous), got %d", len(g))
	}
	if len(g[0].Segments) != 3 {
		t.Errorf("want 3 segments in group, got %d", len(g[0].Segments))
	}
	if g[0].TotalDurationMs != 180000 {
		t.Errorf("total duration = %d, want 180000", g[0].TotalDurationMs)
	}
}

func TestAutoGroupGapBreak(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entryFull("dir/GX010001.mp4", base, 60000, "h264", 1920, 1080),
		// 5s gap: should NOT join
		entryFull("dir/GX010002.mp4", base.Add(65*time.Second), 60000, "h264", 1920, 1080),
	}
	g := AutoGroup(entries)
	if len(g) != 2 {
		t.Fatalf("want 2 groups (gap break), got %d", len(g))
	}
}

func TestAutoGroupCodecBreak(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entryFull("dir/GX010001.mp4", base, 60000, "h264", 1920, 1080),
		entryFull("dir/GX010002.mp4", base.Add(60*time.Second), 60000, "hevc", 1920, 1080),
	}
	g := AutoGroup(entries)
	if len(g) != 2 {
		t.Fatalf("want 2 groups (codec break), got %d", len(g))
	}
}

func TestAutoGroupResolutionBreak(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entryFull("dir/GX010001.mp4", base, 60000, "h264", 1920, 1080),
		entryFull("dir/GX010002.mp4", base.Add(60*time.Second), 60000, "h264", 3840, 2160),
	}
	g := AutoGroup(entries)
	if len(g) != 2 {
		t.Fatalf("want 2 groups (resolution break), got %d", len(g))
	}
}

func TestAutoGroupDirBreak(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entryFull("alice/GX010001.mp4", base, 60000, "h264", 1920, 1080),
		entryFull("bob/GX010001.mp4", base.Add(60*time.Second), 60000, "h264", 1920, 1080),
	}
	g := AutoGroup(entries)
	if len(g) != 2 {
		t.Fatalf("want 2 groups (dir break), got %d", len(g))
	}
}

func TestAutoGroupPrefixBreak(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entryFull("dir/GX010001.mp4", base, 60000, "h264", 1920, 1080),
		// Different first 4 characters → different prefix
		entryFull("dir/DJI_0001.mp4", base.Add(60*time.Second), 60000, "h264", 1920, 1080),
	}
	g := AutoGroup(entries)
	if len(g) != 2 {
		t.Fatalf("want 2 groups (prefix break), got %d", len(g))
	}
}

func TestAutoGroupHevcIncompatible(t *testing.T) {
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entryFull("dir/DJI_0001.mp4", base, 60000, "hevc", 3840, 2160),
	}
	g := AutoGroup(entries)
	if len(g) != 1 {
		t.Fatalf("want 1 group, got %d", len(g))
	}
	if g[0].Compatible {
		t.Errorf("hevc should not be compatible")
	}
}

func TestFilenamePrefix(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"dir/GX010001.mp4", "GX01"},
		{"dir/GX010002.MP4", "GX01"},
		{"dir/abc.mp4", "abc"},
		{"dir/DJI_0001.mp4", "DJI_"},
		{"xyz.mov", "xyz"},
	}
	for _, tc := range cases {
		if got := filenamePrefix(tc.in); got != tc.want {
			t.Errorf("filenamePrefix(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
