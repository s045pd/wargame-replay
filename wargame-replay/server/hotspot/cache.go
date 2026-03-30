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
func LoadCache(dbPath string) ([]HotspotFrame, bool) {
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

	var frames []HotspotFrame
	if err := json.NewDecoder(f).Decode(&frames); err != nil {
		return nil, false
	}
	return frames, true
}

// SaveCache serialises the hotspot frames to the sidecar cache file.
func SaveCache(dbPath string, frames []HotspotFrame) error {
	cachePath := cacheFilePath(dbPath)

	f, err := os.Create(cachePath)
	if err != nil {
		return err
	}
	defer f.Close()

	if err := json.NewEncoder(f).Encode(frames); err != nil {
		return err
	}

	// Touch the cache file to ensure its mtime is at least as new as the DB.
	now := time.Now()
	_ = os.Chtimes(cachePath, now, now)
	return nil
}
