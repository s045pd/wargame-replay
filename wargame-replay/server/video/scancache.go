package video

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// scanCacheFilename is the relative cache file kept inside the video root.
// Hidden + descriptive so users can spot and delete it manually if needed.
const scanCacheFilename = ".wargame-video-index.json"

// scanCacheVersion is bumped any time the on-disk schema changes.
const scanCacheVersion = 1

// scanCacheEntry is one cached file's metadata.  All fields are written
// straight from IndexEntry; we just keep the parts that are stable.
type scanCacheEntry struct {
	FileMTime     time.Time `json:"fileMTime"`
	FileSizeBytes int64     `json:"fileSizeBytes"`
	StartTs       time.Time `json:"startTs"`
	DurationMs    int64     `json:"durationMs"`
	Codec         string    `json:"codec"`
	Width         int       `json:"width"`
	Height        int       `json:"height"`
}

// scanCache wraps the on-disk index keyed by relative path.
type scanCache struct {
	mu      sync.Mutex
	rootDir string
	Version int                       `json:"version"`
	Entries map[string]scanCacheEntry `json:"entries"`
}

// loadScanCache reads the cache file under rootDir, returning a new empty
// cache if the file is missing, malformed, or has an incompatible version.
func loadScanCache(rootDir string) *scanCache {
	cache := &scanCache{
		rootDir: rootDir,
		Version: scanCacheVersion,
		Entries: map[string]scanCacheEntry{},
	}
	if rootDir == "" {
		return cache
	}
	path := filepath.Join(rootDir, scanCacheFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			// Corruption or permission errors are non-fatal: just start fresh.
			return cache
		}
		return cache
	}
	var disk struct {
		Version int                       `json:"version"`
		Entries map[string]scanCacheEntry `json:"entries"`
	}
	if err := json.Unmarshal(data, &disk); err != nil {
		return cache
	}
	if disk.Version != scanCacheVersion {
		return cache
	}
	if disk.Entries == nil {
		disk.Entries = map[string]scanCacheEntry{}
	}
	cache.Entries = disk.Entries
	return cache
}

// lookup returns a cached entry if present.  Caller decides whether the
// underlying file's current mtime/size still matches.
func (c *scanCache) lookup(relPath string) (scanCacheEntry, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.Entries[relPath]
	return e, ok
}

// store inserts or replaces the cache row for relPath.
func (c *scanCache) store(relPath string, entry scanCacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Entries[relPath] = entry
}

// retainOnly drops cache rows whose relPath is not in the supplied set.
// Used after a full scan to garbage-collect entries for files that no
// longer exist on disk.
func (c *scanCache) retainOnly(seen map[string]struct{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for k := range c.Entries {
		if _, ok := seen[k]; !ok {
			delete(c.Entries, k)
		}
	}
}

// save atomically rewrites the cache file under rootDir.  Best-effort: a
// failure to persist is logged by the caller but does not break scans.
func (c *scanCache) save() error {
	if c.rootDir == "" {
		return nil
	}
	c.mu.Lock()
	envelope := struct {
		Version int                       `json:"version"`
		Entries map[string]scanCacheEntry `json:"entries"`
	}{
		Version: scanCacheVersion,
		Entries: c.Entries,
	}
	c.mu.Unlock()

	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal scan cache: %w", err)
	}
	dest := filepath.Join(c.rootDir, scanCacheFilename)
	tmp := dest + ".uploading"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write scan cache tmp: %w", err)
	}
	if err := os.Rename(tmp, dest); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename scan cache: %w", err)
	}
	return nil
}

// matches reports whether the cached entry's mtime + size still match a
// freshly stat'd file.  We deliberately do not compare nanos because some
// filesystems round mtime to seconds.
func (e scanCacheEntry) matches(fileMTime time.Time, fileSize int64) bool {
	if e.FileSizeBytes != fileSize {
		return false
	}
	return e.FileMTime.Equal(fileMTime)
}

// toIndexEntry materializes a cached row back into an IndexEntry.
func (e scanCacheEntry) toIndexEntry(relPath, absPath string) IndexEntry {
	return IndexEntry{
		RelPath:       relPath,
		AbsPath:       absPath,
		StartTs:       e.StartTs,
		DurationMs:    e.DurationMs,
		Codec:         e.Codec,
		Width:         e.Width,
		Height:        e.Height,
		FileSizeBytes: e.FileSizeBytes,
		FileMTime:     e.FileMTime,
	}
}

// fromIndexEntry materializes an IndexEntry into a cache row.
func cacheEntryFromIndex(entry IndexEntry) scanCacheEntry {
	return scanCacheEntry{
		FileMTime:     entry.FileMTime,
		FileSizeBytes: entry.FileSizeBytes,
		StartTs:       entry.StartTs,
		DurationMs:    entry.DurationMs,
		Codec:         entry.Codec,
		Width:         entry.Width,
		Height:        entry.Height,
	}
}
