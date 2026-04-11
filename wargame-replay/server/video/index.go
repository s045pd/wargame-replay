package video

import (
	"sort"
	"sync"
	"time"
)

// Index is an in-memory, thread-safe store of scanned video segments.
// Its contents are rebuilt from scratch by Scanner.Scan via Replace.
type Index struct {
	mu      sync.RWMutex
	entries []IndexEntry   // sorted by StartTs ascending
	byPath  map[string]int // relPath → entries index
}

// NewIndex returns an empty Index.
func NewIndex() *Index {
	return &Index{byPath: map[string]int{}}
}

// Replace swaps in a new set of entries. The input slice is sorted by StartTs
// and then indexed by RelPath.
func (idx *Index) Replace(entries []IndexEntry) {
	dup := make([]IndexEntry, len(entries))
	copy(dup, entries)
	sort.SliceStable(dup, func(i, j int) bool {
		return dup[i].StartTs.Before(dup[j].StartTs)
	})
	byPath := make(map[string]int, len(dup))
	for i, e := range dup {
		byPath[e.RelPath] = i
	}
	idx.mu.Lock()
	idx.entries = dup
	idx.byPath = byPath
	idx.mu.Unlock()
}

// Count returns the number of entries in the index.
func (idx *Index) Count() int {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	return len(idx.entries)
}

// Lookup returns the entry at relPath, if any.
func (idx *Index) Lookup(relPath string) (IndexEntry, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	i, ok := idx.byPath[relPath]
	if !ok {
		return IndexEntry{}, false
	}
	return idx.entries[i], true
}

// FindOverlapping returns all entries whose [StartTs, StartTs+DurationMs]
// intersects the half-open interval [start, end).
//
// The returned slice is a copy; callers may mutate it freely.
func (idx *Index) FindOverlapping(start, end time.Time) []IndexEntry {
	if !end.After(start) {
		return nil
	}
	idx.mu.RLock()
	defer idx.mu.RUnlock()

	n := len(idx.entries)
	if n == 0 {
		return nil
	}

	// Binary search for the first entry whose (StartTs + duration) > start.
	// Because entries are sorted by StartTs (not by StartTs+duration), we
	// scan backwards from that point to catch earlier entries whose duration
	// stretches into the range; then we scan forward.
	//
	// In practice entries have bounded durations (< 1 hour typically), so
	// overshooting by a few entries is cheap. We still do a bisect on
	// StartTs to avoid touching the whole slice.
	firstCandidate := sort.Search(n, func(i int) bool {
		return !idx.entries[i].StartTs.Before(start)
	})
	// Walk backwards a few entries because an entry that starts before
	// `start` might still overlap it.
	scanFrom := firstCandidate - 1
	for scanFrom >= 0 {
		e := idx.entries[scanFrom]
		endTs := e.StartTs.Add(time.Duration(e.DurationMs) * time.Millisecond)
		if endTs.After(start) {
			scanFrom--
			continue
		}
		break
	}
	scanFrom++
	if scanFrom < 0 {
		scanFrom = 0
	}

	out := make([]IndexEntry, 0)
	for i := scanFrom; i < n; i++ {
		e := idx.entries[i]
		if !e.StartTs.Before(end) {
			break
		}
		endTs := e.StartTs.Add(time.Duration(e.DurationMs) * time.Millisecond)
		if endTs.Before(start) || endTs.Equal(start) {
			continue
		}
		out = append(out, e)
	}
	return out
}

// Entries returns a copy of all entries, sorted by StartTs ascending.
func (idx *Index) Entries() []IndexEntry {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	dup := make([]IndexEntry, len(idx.entries))
	copy(dup, idx.entries)
	return dup
}

// AnnotateStale walks each segment in every group, checks whether the
// underlying file still exists on disk, and sets the Stale flag on the
// segment accordingly. A segment is stale when:
//
//   - it is no longer in the in-memory index (file removed/renamed), or
//   - its current mtime on disk is newer than what the sidecar records
//     (content changed since the group was created).
//
// Mutates groups in place for efficiency; callers use the same slice.
func (idx *Index) AnnotateStale(groups []VideoGroup) {
	idx.mu.RLock()
	entries := idx.byPath
	snapshot := idx.entries
	idx.mu.RUnlock()

	for gi := range groups {
		for si := range groups[gi].Segments {
			seg := &groups[gi].Segments[si]
			i, ok := entries[seg.RelPath]
			if !ok {
				seg.Stale = true
				continue
			}
			live := snapshot[i]
			// mtime changed → file was rewritten; treat as stale so the
			// UI prompts the user to re-associate.
			if !live.FileMTime.Equal(seg.FileMTime) {
				seg.Stale = true
				continue
			}
			seg.Stale = false
		}
	}
}
