package hotspot

import (
	"encoding/json"
	"os"
	"time"
)

// cacheFilePath returns the sidecar cache path for a DB file.
func cacheFilePath(dbPath string) string {
	return dbPath + ".hotspots.cache"
}

// LoadCache attempts to read a previously computed hotspot result from disk.
// It returns nil, false if the cache is absent, unreadable, or stale (DB file
// is newer than the cache file).
func LoadCache(dbPath string) ([]HotspotEvent, bool) {
	cachePath := cacheFilePath(dbPath)

	cacheInfo, err := os.Stat(cachePath)
	if err != nil {
		return nil, false
	}

	dbInfo, err := os.Stat(dbPath)
	if err != nil {
		return nil, false
	}

	// Invalidate cache when the source DB is newer.
	if dbInfo.ModTime().After(cacheInfo.ModTime()) {
		return nil, false
	}

	f, err := os.Open(cachePath)
	if err != nil {
		return nil, false
	}
	defer f.Close()

	var events []HotspotEvent
	if err := json.NewDecoder(f).Decode(&events); err != nil {
		return nil, false
	}
	// Reject empty cached results — force recomputation
	if len(events) == 0 {
		return nil, false
	}
	return events, true
}

// SaveCache serialises the hotspot events to the sidecar cache file.
// Uses atomic write (tmp + rename) to avoid corrupting existing cache on error.
func SaveCache(dbPath string, events []HotspotEvent) error {
	cachePath := cacheFilePath(dbPath)
	tmpPath := cachePath + ".tmp"

	f, err := os.Create(tmpPath)
	if err != nil {
		return err
	}

	if err := json.NewEncoder(f).Encode(events); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}

	if err := os.Rename(tmpPath, cachePath); err != nil {
		os.Remove(tmpPath)
		return err
	}

	// Touch the cache file to ensure its mtime is at least as new as the DB.
	now := time.Now()
	_ = os.Chtimes(cachePath, now, now)
	return nil
}
