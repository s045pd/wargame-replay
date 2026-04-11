package video

import (
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// maxGap is the maximum temporal gap between two segments that still counts
// as "one continuous recording" (GoPro / DJI split files have sub-second gaps
// in practice).
const maxGap = 1 * time.Second

// AutoGroup collapses a list of IndexEntry values into CandidateGroups based
// on directory, filename prefix, codec, resolution and temporal continuity.
//
// The input slice is not mutated; the output is sorted by the earliest
// StartTs of each group.
func AutoGroup(entries []IndexEntry) []CandidateGroup {
	if len(entries) == 0 {
		return nil
	}

	sorted := make([]IndexEntry, len(entries))
	copy(sorted, entries)
	sort.SliceStable(sorted, func(i, j int) bool {
		di, dj := filepath.Dir(sorted[i].AbsPath), filepath.Dir(sorted[j].AbsPath)
		if di != dj {
			return di < dj
		}
		pi, pj := filenamePrefix(sorted[i].AbsPath), filenamePrefix(sorted[j].AbsPath)
		if pi != pj {
			return pi < pj
		}
		return sorted[i].StartTs.Before(sorted[j].StartTs)
	})

	groups := make([]CandidateGroup, 0)
	var current []IndexEntry
	for i, e := range sorted {
		if i == 0 {
			current = []IndexEntry{e}
			continue
		}
		prev := current[len(current)-1]
		if continuous(prev, e) {
			current = append(current, e)
			continue
		}
		groups = append(groups, buildCandidate(current))
		current = []IndexEntry{e}
	}
	if len(current) > 0 {
		groups = append(groups, buildCandidate(current))
	}

	sort.SliceStable(groups, func(i, j int) bool {
		return groups[i].Segments[0].StartTs.Before(groups[j].Segments[0].StartTs)
	})
	return groups
}

// continuous reports whether b can be appended to the group ending at a.
func continuous(a, b IndexEntry) bool {
	if filepath.Dir(a.AbsPath) != filepath.Dir(b.AbsPath) {
		return false
	}
	if filenamePrefix(a.AbsPath) != filenamePrefix(b.AbsPath) {
		return false
	}
	if strings.EqualFold(a.Codec, b.Codec) == false {
		return false
	}
	if a.Width != b.Width || a.Height != b.Height {
		return false
	}
	prevEnd := a.StartTs.Add(time.Duration(a.DurationMs) * time.Millisecond)
	gap := b.StartTs.Sub(prevEnd)
	if gap < -maxGap || gap > maxGap {
		return false
	}
	return true
}

// filenamePrefix returns a short canonical prefix used to cluster segments
// from the same recording. GoPro uses e.g. GX010001 / GX020001 where the
// first two ASCII letters identify the device & lens, so a 4-character prefix
// catches most real-world split-file schemes without over-collapsing.
func filenamePrefix(path string) string {
	base := filepath.Base(path)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	if len(base) > 4 {
		return base[:4]
	}
	return base
}

func buildCandidate(entries []IndexEntry) CandidateGroup {
	segs := make([]VideoSegment, len(entries))
	var total int64
	for i, e := range entries {
		segs[i] = e.ToSegment()
		total += e.DurationMs
	}
	codec := ""
	compatible := true
	if len(entries) > 0 {
		codec = entries[0].Codec
	}
	for _, s := range segs {
		if !s.Compatible {
			compatible = false
		}
	}
	first := entries[0]
	// AutoGroupKey is only used as a UI label; strip any leading "/" so
	// long absolute paths look less noisy without changing uniqueness.
	dir := filepath.Base(filepath.Dir(first.AbsPath))
	key := filepath.ToSlash(filepath.Join(dir, filenamePrefix(first.AbsPath)))
	return CandidateGroup{
		AutoGroupKey:    key,
		Segments:        segs,
		TotalDurationMs: total,
		Codec:           codec,
		Compatible:      compatible,
	}
}
