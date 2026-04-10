package video

import (
	"io/fs"
	"log"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Scanner walks a root directory, parses metadata from recognised video files,
// and populates an Index.
//
// An empty rootDir disables the feature: Enabled() returns false and Scan is
// a no-op.
type Scanner struct {
	rootDir string
	index   *Index

	mu         sync.Mutex
	scanning   bool
	lastScanAt time.Time
}

// NewScanner returns a Scanner rooted at rootDir. When rootDir is empty, the
// feature is disabled.
func NewScanner(rootDir string) *Scanner {
	return &Scanner{
		rootDir: rootDir,
		index:   NewIndex(),
	}
}

// Enabled reports whether a root directory was configured.
func (s *Scanner) Enabled() bool { return s.rootDir != "" }

// RootDir returns the configured root directory.
func (s *Scanner) RootDir() string { return s.rootDir }

// Index returns the backing index.
func (s *Scanner) Index() *Index { return s.index }

// Scanning reports whether a scan is currently running.
func (s *Scanner) Scanning() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.scanning
}

// LastScanAt reports when the most recent scan finished.
func (s *Scanner) LastScanAt() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastScanAt
}

// Status snapshots the feature state.
func (s *Scanner) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Status{
		Enabled:      s.rootDir != "",
		RootDir:      s.rootDir,
		SegmentCount: s.index.Count(),
		LastScanAt:   s.lastScanAt,
		Scanning:     s.scanning,
	}
}

// Scan walks rootDir recursively and rebuilds the index. It is safe to call
// concurrently, but only one scan runs at a time.
func (s *Scanner) Scan() error {
	if !s.Enabled() {
		return nil
	}
	s.mu.Lock()
	if s.scanning {
		s.mu.Unlock()
		return nil
	}
	s.scanning = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.scanning = false
		s.lastScanAt = time.Now().UTC()
		s.mu.Unlock()
	}()

	entries := make([]IndexEntry, 0, 256)
	err := filepath.WalkDir(s.rootDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			log.Printf("video: walk error at %s: %v", path, walkErr)
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !isVideoExt(path) {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			log.Printf("video: stat %s: %v", path, err)
			return nil
		}

		meta, err := Parse(path)
		if err != nil {
			log.Printf("video: parse %s: %v", path, err)
			return nil
		}

		rel, err := filepath.Rel(s.rootDir, path)
		if err != nil {
			log.Printf("video: rel %s: %v", path, err)
			return nil
		}
		rel = filepath.ToSlash(rel)

		entries = append(entries, IndexEntry{
			RelPath:       rel,
			AbsPath:       path,
			StartTs:       meta.CreationTime,
			DurationMs:    meta.DurationMs,
			Codec:         meta.Codec,
			Width:         meta.Width,
			Height:        meta.Height,
			FileSizeBytes: info.Size(),
			FileMTime:     info.ModTime().UTC(),
		})
		return nil
	})
	if err != nil {
		return err
	}

	s.index.Replace(entries)
	log.Printf("video: indexed %d segments from %s", len(entries), s.rootDir)
	return nil
}

// isVideoExt returns true when the extension matches a container we know how
// to parse. Case-insensitive.
func isVideoExt(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp4", ".m4v", ".mov":
		return true
	}
	return false
}
