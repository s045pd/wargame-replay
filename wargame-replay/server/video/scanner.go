package video

import (
	"fmt"
	"io/fs"
	"log"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Scanner walks one or more user-provided source directories, parses
// metadata from recognised video files, and populates an Index.
//
// Starting with Phase 3, the scanner is multi-source: the user adds and
// removes source directories at runtime via the HTTP API and they are
// persisted to {dataDir}/.wargame-video-sources.json.  Legacy callers can
// still supply an initial directory via NewScannerWithInitial, which is
// how the -videodir startup flag plumbs through.
type Scanner struct {
	dataDir string // where sources.json + scan cache live
	index   *Index

	mu         sync.Mutex
	sources    []string // absolute, symlink-resolved, deduplicated
	scanning   bool
	lastScanAt time.Time
}

// NewScanner returns a Scanner that persists sources under dataDir.
// Passing an empty dataDir is permitted but disables persistence.
func NewScanner(dataDir string) *Scanner {
	s := &Scanner{
		dataDir: dataDir,
		index:   NewIndex(),
	}
	if dataDir != "" {
		if persisted, err := loadSources(dataDir); err != nil {
			log.Printf("video: load sources: %v", err)
		} else {
			s.sources = persisted
		}
	}
	return s
}

// NewScannerWithInitial is a convenience constructor that also inserts one
// initial source directory if it does not already appear in the persisted
// list.  Used by main.go to plumb through the -videodir flag.
func NewScannerWithInitial(dataDir, initial string) *Scanner {
	s := NewScanner(dataDir)
	if initial == "" {
		return s
	}
	abs, err := canonicalizeDir(initial)
	if err != nil {
		log.Printf("video: ignoring initial source %q: %v", initial, err)
		return s
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !containsString(s.sources, abs) {
		s.sources = append(s.sources, abs)
		if err := saveSources(s.dataDir, s.sources); err != nil {
			log.Printf("video: save sources: %v", err)
		}
	}
	return s
}

// Enabled reports whether at least one source directory is configured.
// With zero sources the feature is still addressable (the UI uses the
// sources API to add one) but no segments are indexed yet.
func (s *Scanner) Enabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sources) > 0
}

// Sources returns a copy of the current source directory list.
func (s *Scanner) Sources() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, len(s.sources))
	copy(out, s.sources)
	return out
}

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
	sourcesCopy := make([]string, len(s.sources))
	copy(sourcesCopy, s.sources)
	return Status{
		Enabled:      len(s.sources) > 0,
		Sources:      sourcesCopy,
		SegmentCount: s.index.Count(),
		LastScanAt:   s.lastScanAt,
		Scanning:     s.scanning,
	}
}

// AddSource canonicalizes the provided directory, persists it to the
// sources file, then triggers an incremental scan so new entries become
// addressable immediately.  It is idempotent: adding the same directory
// twice is a no-op for the second call.
func (s *Scanner) AddSource(path string) (string, error) {
	abs, err := canonicalizeDir(path)
	if err != nil {
		return "", fmt.Errorf("canonicalize source %q: %w", path, err)
	}
	s.mu.Lock()
	if containsString(s.sources, abs) {
		s.mu.Unlock()
		return abs, nil
	}
	s.sources = append(s.sources, abs)
	sourcesSnapshot := append([]string(nil), s.sources...)
	s.mu.Unlock()

	if err := saveSources(s.dataDir, sourcesSnapshot); err != nil {
		return "", fmt.Errorf("persist sources: %w", err)
	}
	if err := s.Scan(); err != nil {
		return "", fmt.Errorf("scan after add: %w", err)
	}
	return abs, nil
}

// RemoveSource drops a source by its canonical absolute path.  Returns
// ErrSourceUnknown when the path is not currently registered.
func (s *Scanner) RemoveSource(path string) error {
	abs, err := canonicalizeDir(path)
	if err != nil {
		// Fall back to raw string match — the user may have given us a
		// symlinked path that no longer resolves.
		abs = path
	}
	s.mu.Lock()
	idx := -1
	for i, src := range s.sources {
		if src == abs {
			idx = i
			break
		}
	}
	if idx < 0 {
		s.mu.Unlock()
		return ErrSourceUnknown
	}
	s.sources = append(s.sources[:idx], s.sources[idx+1:]...)
	sourcesSnapshot := append([]string(nil), s.sources...)
	s.mu.Unlock()

	if err := saveSources(s.dataDir, sourcesSnapshot); err != nil {
		return fmt.Errorf("persist sources: %w", err)
	}
	return s.Scan()
}

// IsInsideSource reports whether the given absolute path lies beneath any
// registered source directory.  Used by the stream handler for path safety.
//
// Both sides are symlink-resolved before comparison, so a symlink inside a
// source cannot escape.
func (s *Scanner) IsInsideSource(absPath string) bool {
	realPath, err := filepath.EvalSymlinks(absPath)
	if err != nil {
		return false
	}
	s.mu.Lock()
	sources := append([]string(nil), s.sources...)
	s.mu.Unlock()
	for _, src := range sources {
		realSrc, err := filepath.EvalSymlinks(src)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(realSrc, realPath)
		if err != nil {
			continue
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		return true
	}
	return false
}

// Scan walks every registered source directory, merges results into a
// single Index, and updates the scan cache.  Safe to call concurrently,
// but only one scan runs at a time.
//
// Files whose mtime + size still match the cache are reused without
// re-parsing; new or modified files are parsed; vanished files are
// dropped from the cache.
func (s *Scanner) Scan() error {
	s.mu.Lock()
	if s.scanning {
		s.mu.Unlock()
		return nil
	}
	s.scanning = true
	sourcesSnapshot := append([]string(nil), s.sources...)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		s.scanning = false
		s.lastScanAt = time.Now().UTC()
		s.mu.Unlock()
	}()

	cache := loadScanCache(s.dataDir)
	seen := make(map[string]struct{}, 256)
	entries := make([]IndexEntry, 0, 256)
	var reused, parsed int

	for _, sourceDir := range sourcesSnapshot {
		if err := walkOneSource(sourceDir, cache, seen, &entries, &reused, &parsed); err != nil {
			log.Printf("video: scan %s: %v", sourceDir, err)
		}
	}

	cache.retainOnly(seen)
	if err := cache.save(); err != nil {
		log.Printf("video: scan cache save failed: %v", err)
	}

	// Deterministic order: sort by absolute path so the index is stable
	// across runs regardless of filesystem walk order.
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].AbsPath < entries[j].AbsPath
	})

	s.index.Replace(entries)
	log.Printf(
		"video: indexed %d segments from %d source(s) (cache hits: %d, parsed: %d)",
		len(entries), len(sourcesSnapshot), reused, parsed,
	)
	return nil
}

// walkOneSource adds all recognised video files under sourceDir to entries,
// consulting and updating cache along the way.  Errors at individual files
// are logged and ignored — one bad mp4 should not abort the whole scan.
func walkOneSource(
	sourceDir string,
	cache *scanCache,
	seen map[string]struct{},
	entries *[]IndexEntry,
	reused, parsed *int,
) error {
	return filepath.WalkDir(sourceDir, func(path string, d fs.DirEntry, walkErr error) error {
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
		absPath, err := filepath.Abs(path)
		if err != nil {
			log.Printf("video: abs %s: %v", path, err)
			return nil
		}
		seen[absPath] = struct{}{}

		mtimeUTC := info.ModTime().UTC()
		size := info.Size()

		// Cache hit: reuse parsed metadata, no mp4 work needed.
		if cached, ok := cache.lookup(absPath); ok && cached.matches(mtimeUTC, size) {
			*entries = append(*entries, cached.toIndexEntry(absPath))
			*reused++
			return nil
		}

		meta, err := Parse(path)
		if err != nil {
			log.Printf("video: parse %s: %v", path, err)
			return nil
		}
		// Fallback: if the mp4 moov box has no creation_time (e.g. RunCam,
		// some action cameras), try to extract a timestamp from the filename.
		// Also fall back to file mtime as a last resort.
		if meta.CreationTime.IsZero() || meta.CreationTime.Year() < 2000 {
			if fnTs := parseFilenameTimestamp(filepath.Base(path)); !fnTs.IsZero() {
				meta.CreationTime = fnTs
			} else {
				meta.CreationTime = mtimeUTC
			}
		}
		entry := IndexEntry{
			AbsPath:       absPath,
			StartTs:       meta.CreationTime,
			DurationMs:    meta.DurationMs,
			Codec:         meta.Codec,
			Width:         meta.Width,
			Height:        meta.Height,
			FileSizeBytes: size,
			FileMTime:     mtimeUTC,
		}
		*entries = append(*entries, entry)
		cache.store(absPath, cacheEntryFromIndex(entry))
		*parsed++
		return nil
	})
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

// parseFilenameTimestamp attempts to extract a recording start time from a
// video filename. Many action cameras that do not write moov.mvhd
// creation_time still embed the timestamp in the filename:
//
//   RunCam:   Helmetcam2_0001_M_20260328113700.MP4
//   Generic:  VID_20260328_113700.mp4
//   DJI:      DJI_20260328113700_0001.MP4
//
// The function searches for the first occurrence of a YYYYMMDDHHMMSS (14-digit)
// or YYYYMMDD_HHMMSS (15-char) pattern and parses it as local time (matching
// the game timestamp convention).
func parseFilenameTimestamp(basename string) time.Time {
	// Strip extension.
	name := strings.TrimSuffix(basename, filepath.Ext(basename))

	// Try to find a 14-digit run that looks like YYYYMMDDHHmmss.
	digits := make([]byte, 0, 14)
	for i := 0; i < len(name); i++ {
		c := name[i]
		if c >= '0' && c <= '9' {
			digits = append(digits, c)
			if len(digits) == 14 {
				break
			}
		} else {
			// Allow a single underscore/hyphen/space between date and time
			// (e.g. "20260328_113700") without resetting.
			if len(digits) == 8 && (c == '_' || c == '-' || c == ' ') {
				continue
			}
			if len(digits) > 0 && len(digits) < 8 {
				// Not enough for a date yet — reset.
				digits = digits[:0]
			} else if len(digits) >= 8 && len(digits) < 14 {
				// Had date but interrupted before time — reset.
				digits = digits[:0]
			}
		}
	}
	if len(digits) < 14 {
		return time.Time{}
	}
	s := string(digits)
	t, err := time.ParseInLocation("20060102150405", s, time.Local)
	if err != nil {
		return time.Time{}
	}
	// Sanity: reject dates before 2010 or after 2040.
	if t.Year() < 2010 || t.Year() > 2040 {
		return time.Time{}
	}
	return t
}

// canonicalizeDir resolves a user-provided path to an absolute, cleaned
// directory path.  It rejects non-directories and non-existent paths.
// Symlinks are resolved so callers can rely on comparisons working.
func canonicalizeDir(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("empty path")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("abs: %w", err)
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("eval symlinks: %w", err)
	}
	// Refuse non-directories so callers cannot accidentally register a
	// single file as a source.
	info, err := fsStat(real)
	if err != nil {
		return "", fmt.Errorf("stat: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory: %s", real)
	}
	return filepath.Clean(real), nil
}

// containsString is a tiny helper kept local to avoid pulling in slices
// package for one call (go.mod is 1.21, slices.Contains is available but
// we keep the helper for readability next to RemoveSource's manual index
// search).
func containsString(ss []string, target string) bool {
	for _, s := range ss {
		if s == target {
			return true
		}
	}
	return false
}
