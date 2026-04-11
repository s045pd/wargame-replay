package video

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// sourcesFilename is the persistence file under the data directory
// (the -dir argument to the server).  It is intentionally dotfile-style
// so it does not show up in directory listings by default.
const sourcesFilename = ".wargame-video-sources.json"

// sourcesVersion is bumped when the on-disk schema breaks compatibility.
const sourcesVersion = 1

// sourcesEnvelope is the JSON shape persisted to disk.
type sourcesEnvelope struct {
	Version int      `json:"version"`
	Sources []string `json:"sources"`
}

// ErrSourceUnknown is returned by Scanner.RemoveSource when the supplied
// path is not currently registered.
var ErrSourceUnknown = errors.New("source not registered")

// loadSources reads the persisted source list under dataDir.  Missing
// file → empty list, no error.  Unreadable or corrupted → empty list +
// the underlying error so the caller can log it.
func loadSources(dataDir string) ([]string, error) {
	if dataDir == "" {
		return nil, nil
	}
	path := filepath.Join(dataDir, sourcesFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var env sourcesEnvelope
	if err := json.Unmarshal(data, &env); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if env.Version != sourcesVersion {
		return nil, fmt.Errorf("unsupported sources schema version %d", env.Version)
	}
	// Drop empty strings to keep the list clean.
	out := make([]string, 0, len(env.Sources))
	for _, s := range env.Sources {
		if s != "" {
			out = append(out, s)
		}
	}
	return out, nil
}

// saveSources atomically rewrites the sources file.  Passing an empty
// slice removes the file so the disk matches the in-memory state.
func saveSources(dataDir string, sources []string) error {
	if dataDir == "" {
		return nil
	}
	path := filepath.Join(dataDir, sourcesFilename)
	if len(sources) == 0 {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove empty sources file: %w", err)
		}
		return nil
	}
	env := sourcesEnvelope{Version: sourcesVersion, Sources: sources}
	data, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal sources: %w", err)
	}
	tmp := path + ".uploading"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return fmt.Errorf("write tmp sources: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename sources: %w", err)
	}
	return nil
}

// fsStat wraps os.Stat so tests can override it if needed, and keeps the
// Scanner file from needing a direct "os" import.
func fsStat(path string) (os.FileInfo, error) {
	return os.Stat(path)
}
