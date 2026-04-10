package video

import (
	"fmt"
	"testing"
	"time"
)

func mustParseTs(t *testing.T, s string) time.Time {
	t.Helper()
	v, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func entry(relPath string, start time.Time, durationMs int64) IndexEntry {
	return IndexEntry{
		RelPath:    relPath,
		StartTs:    start,
		DurationMs: durationMs,
		Codec:      "h264",
		Width:      1920,
		Height:     1080,
	}
}

func TestIndexReplaceAndCount(t *testing.T) {
	idx := NewIndex()
	if idx.Count() != 0 {
		t.Fatalf("initial count = %d, want 0", idx.Count())
	}
	entries := []IndexEntry{
		entry("b.mp4", mustParseTs(t, "2026-01-01T12:00:10Z"), 5000),
		entry("a.mp4", mustParseTs(t, "2026-01-01T12:00:00Z"), 5000),
	}
	idx.Replace(entries)
	if idx.Count() != 2 {
		t.Fatalf("count = %d, want 2", idx.Count())
	}
	// Replace should sort by StartTs ascending.
	list := idx.Entries()
	if list[0].RelPath != "a.mp4" || list[1].RelPath != "b.mp4" {
		t.Errorf("unsorted: %v", list)
	}
}

func TestIndexLookup(t *testing.T) {
	idx := NewIndex()
	e := entry("foo.mp4", mustParseTs(t, "2026-01-01T00:00:00Z"), 1000)
	idx.Replace([]IndexEntry{e})
	got, ok := idx.Lookup("foo.mp4")
	if !ok {
		t.Fatal("lookup missed")
	}
	if got.RelPath != "foo.mp4" {
		t.Errorf("got = %v", got)
	}
	if _, ok := idx.Lookup("nope.mp4"); ok {
		t.Errorf("lookup for missing path should return false")
	}
}

func TestIndexFindOverlapping(t *testing.T) {
	// Build a fake day: a.mp4 00:00-00:30, b.mp4 00:30-01:00, c.mp4 02:00-02:30
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	half := int64(30 * 60 * 1000)
	entries := []IndexEntry{
		entry("a.mp4", base, half),
		entry("b.mp4", base.Add(30*time.Minute), half),
		entry("c.mp4", base.Add(120*time.Minute), half),
	}
	idx := NewIndex()
	idx.Replace(entries)

	cases := []struct {
		name     string
		start    time.Time
		end      time.Time
		wantRels []string
	}{
		{
			name:     "covers all",
			start:    base,
			end:      base.Add(3 * time.Hour),
			wantRels: []string{"a.mp4", "b.mp4", "c.mp4"},
		},
		{
			name:     "before c only",
			start:    base,
			end:      base.Add(50 * time.Minute),
			wantRels: []string{"a.mp4", "b.mp4"},
		},
		{
			name:     "c only",
			start:    base.Add(110 * time.Minute),
			end:      base.Add(130 * time.Minute),
			wantRels: []string{"c.mp4"},
		},
		{
			name:     "between b and c (empty gap)",
			start:    base.Add(70 * time.Minute),
			end:      base.Add(90 * time.Minute),
			wantRels: nil,
		},
		{
			name:     "touches a's tail",
			start:    base.Add(25 * time.Minute),
			end:      base.Add(26 * time.Minute),
			wantRels: []string{"a.mp4"},
		},
		{
			name:     "empty range",
			start:    base,
			end:      base,
			wantRels: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := idx.FindOverlapping(tc.start, tc.end)
			if len(got) != len(tc.wantRels) {
				t.Fatalf("got %d entries %v, want %v", len(got), relsOf(got), tc.wantRels)
			}
			for i, e := range got {
				if e.RelPath != tc.wantRels[i] {
					t.Errorf("entry %d = %s, want %s", i, e.RelPath, tc.wantRels[i])
				}
			}
		})
	}
}

func relsOf(entries []IndexEntry) []string {
	out := make([]string, len(entries))
	for i, e := range entries {
		out[i] = e.RelPath
	}
	return out
}

func TestIndexConcurrent(t *testing.T) {
	idx := NewIndex()
	base := mustParseTs(t, "2026-01-01T00:00:00Z")
	entries := []IndexEntry{
		entry("a.mp4", base, 1000),
	}
	idx.Replace(entries)
	done := make(chan struct{})
	for i := 0; i < 10; i++ {
		go func(i int) {
			for j := 0; j < 100; j++ {
				_ = idx.Count()
				_, _ = idx.Lookup("a.mp4")
				_ = idx.FindOverlapping(base, base.Add(10*time.Second))
				if j%50 == 0 {
					idx.Replace([]IndexEntry{
						entry(fmt.Sprintf("file-%d-%d.mp4", i, j), base, 1000),
					})
				}
			}
			done <- struct{}{}
		}(i)
	}
	for i := 0; i < 10; i++ {
		<-done
	}
}
