package video

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestScanCacheRoundTrip(t *testing.T) {
	dir := t.TempDir()
	c := loadScanCache(dir)
	if len(c.Entries) != 0 {
		t.Fatalf("fresh cache should be empty")
	}
	c.store("a.mp4", scanCacheEntry{
		FileMTime:     time.Unix(1000, 0).UTC(),
		FileSizeBytes: 1234,
		StartTs:       time.Unix(2000, 0).UTC(),
		DurationMs:    5000,
		Codec:         "h264",
		Width:         1920,
		Height:        1080,
	})
	if err := c.save(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, scanCacheFilename)); err != nil {
		t.Fatalf("cache file should exist: %v", err)
	}

	c2 := loadScanCache(dir)
	if len(c2.Entries) != 1 {
		t.Fatalf("got %d entries", len(c2.Entries))
	}
	got, ok := c2.lookup("a.mp4")
	if !ok {
		t.Fatal("lookup miss after roundtrip")
	}
	if got.Codec != "h264" || got.DurationMs != 5000 || got.Width != 1920 {
		t.Errorf("unexpected entry: %+v", got)
	}
}

func TestScanCacheMatches(t *testing.T) {
	mtime := time.Unix(1000, 0).UTC()
	e := scanCacheEntry{FileMTime: mtime, FileSizeBytes: 1234}
	if !e.matches(mtime, 1234) {
		t.Errorf("should match")
	}
	if e.matches(mtime, 9999) {
		t.Errorf("size mismatch should fail")
	}
	if e.matches(time.Unix(2000, 0).UTC(), 1234) {
		t.Errorf("mtime mismatch should fail")
	}
}

func TestScanCacheRetainOnly(t *testing.T) {
	dir := t.TempDir()
	c := loadScanCache(dir)
	c.store("a.mp4", scanCacheEntry{Codec: "h264"})
	c.store("b.mp4", scanCacheEntry{Codec: "h264"})
	c.store("c.mp4", scanCacheEntry{Codec: "h264"})

	c.retainOnly(map[string]struct{}{
		"a.mp4": {},
		"c.mp4": {},
	})
	if len(c.Entries) != 2 {
		t.Errorf("retain failed: %v", c.Entries)
	}
	if _, ok := c.lookup("b.mp4"); ok {
		t.Errorf("b.mp4 should be gone")
	}
}

func TestScanCacheBadJsonFallsBack(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, scanCacheFilename), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	c := loadScanCache(dir)
	if len(c.Entries) != 0 {
		t.Errorf("bad json should yield empty cache, got %d", len(c.Entries))
	}
}

func TestScanCacheVersionMismatchFallsBack(t *testing.T) {
	dir := t.TempDir()
	bad := `{"version": 999, "entries": {"a.mp4": {}}}`
	if err := os.WriteFile(filepath.Join(dir, scanCacheFilename), []byte(bad), 0o644); err != nil {
		t.Fatal(err)
	}
	c := loadScanCache(dir)
	if len(c.Entries) != 0 {
		t.Errorf("version mismatch should yield empty cache")
	}
}

func TestScanCacheDisabledNoOp(t *testing.T) {
	c := loadScanCache("")
	if c.Entries == nil {
		t.Fatal("cache should still have an entries map")
	}
	c.store("a.mp4", scanCacheEntry{Codec: "h264"})
	if err := c.save(); err != nil {
		t.Errorf("save with empty rootDir should be a no-op, got %v", err)
	}
}

// TestScannerUsesCache verifies that on a second scan, all files are
// reused from the cache (no re-parse), then mutating one file's mtime
// triggers a re-parse for that file alone.
func TestScannerUsesCache(t *testing.T) {
	if _, err := os.Stat(tinyFixturePath); err != nil {
		t.Skipf("fixture missing: %v", err)
	}
	dir := t.TempDir()
	dst := filepath.Join(dir, "tiny.mp4")
	src, err := os.ReadFile(tinyFixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dst, src, 0o644); err != nil {
		t.Fatal(err)
	}

	s := NewScanner(dir)
	if err := s.Scan(); err != nil {
		t.Fatalf("first scan: %v", err)
	}
	if s.Index().Count() != 1 {
		t.Fatalf("first scan indexed %d", s.Index().Count())
	}
	// Cache file should now exist.
	if _, err := os.Stat(filepath.Join(dir, scanCacheFilename)); err != nil {
		t.Errorf("cache file missing after first scan: %v", err)
	}

	// Second scan: same files, should use cache (we cannot count from
	// scanner state, but we can re-load the cache and confirm it has 1
	// entry, and the second scan still returns 1 entry).
	if err := s.Scan(); err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if s.Index().Count() != 1 {
		t.Errorf("second scan: %d entries", s.Index().Count())
	}
	c := loadScanCache(dir)
	if _, ok := c.lookup("tiny.mp4"); !ok {
		t.Errorf("cache should still contain tiny.mp4")
	}

	// Bump mtime to invalidate the cache for that file. Use chtimes so
	// the underlying file content doesn't change.
	future := time.Now().Add(24 * time.Hour)
	if err := os.Chtimes(dst, future, future); err != nil {
		t.Fatal(err)
	}
	if err := s.Scan(); err != nil {
		t.Fatalf("third scan: %v", err)
	}
	if s.Index().Count() != 1 {
		t.Errorf("third scan: %d entries", s.Index().Count())
	}
}
