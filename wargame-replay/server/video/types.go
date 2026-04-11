// Package video implements the video sync feature: scanning user-provided
// video files, auto-grouping segments from continuous recordings, and
// persisting associations between games and camera angles via sidecar JSON.
//
// Videos stay in place on disk. The platform only reads metadata (via a
// minimal built-in mp4 parser) and streams bytes on demand using HTTP Range.
package video

import (
	"strings"
	"time"
)

// SidecarSuffix is appended to a .db file path to get the sidecar JSON path.
const SidecarSuffix = ".videos.json"

// SidecarVersion is the on-disk schema version.
const SidecarVersion = 1

// VideoSegment is one contiguous piece of recording (typically one .mp4 file).
//
// As of Phase 3, the Path field stores the segment's absolute path on the
// server's filesystem. The JSON tag is still "relPath" so existing sidecar
// files keep working; the name is historical. Path safety is enforced in
// the stream handler by verifying the path lies under one of the
// currently registered source directories.
type VideoSegment struct {
	Path          string    `json:"relPath"`
	StartTs       time.Time `json:"startTs"`
	DurationMs    int64     `json:"durationMs"`
	Codec         string    `json:"codec"`
	Width         int       `json:"width"`
	Height        int       `json:"height"`
	FileSizeBytes int64     `json:"fileSizeBytes"`
	FileMTime     time.Time `json:"fileMTime"`
	Compatible    bool      `json:"compatible"`
	// Stale is computed at response time; not written to disk.
	// True when the file is missing from the index, removed from disk, or
	// its mtime is newer than what the sidecar recorded.
	Stale bool `json:"stale,omitempty"`
}

// VideoGroup associates one or more continuous segments with a single unit
// (angle / camera) and stores an alignment offset.
//
// Semantics: gameMs = videoMs + OffsetMs.
// A negative OffsetMs means the video started before the game timestamp.
type VideoGroup struct {
	ID          string         `json:"id"`
	UnitID      int            `json:"unitId"`
	CameraLabel string         `json:"cameraLabel"`
	OffsetMs    int64          `json:"offsetMs"`
	Segments    []VideoSegment `json:"segments"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	Notes       string         `json:"notes,omitempty"`
}

// IndexEntry is one row in the in-memory scan index, keyed by the segment's
// canonical absolute path on disk.
type IndexEntry struct {
	AbsPath       string    `json:"-"`
	StartTs       time.Time `json:"startTs"`
	DurationMs    int64     `json:"durationMs"`
	Codec         string    `json:"codec"`
	Width         int       `json:"width"`
	Height        int       `json:"height"`
	FileSizeBytes int64     `json:"fileSizeBytes"`
	FileMTime     time.Time `json:"fileMTime"`
}

// ToSegment converts an IndexEntry into the JSON-serialized VideoSegment
// the frontend sees.  VideoSegment.Path carries the absolute path (the
// JSON tag is still "relPath" for sidecar backwards-compatibility).
func (e IndexEntry) ToSegment() VideoSegment {
	return VideoSegment{
		Path:          e.AbsPath,
		StartTs:       e.StartTs,
		DurationMs:    e.DurationMs,
		Codec:         e.Codec,
		Width:         e.Width,
		Height:        e.Height,
		FileSizeBytes: e.FileSizeBytes,
		FileMTime:     e.FileMTime,
		Compatible:    IsCompatibleCodec(e.Codec),
	}
}

// CandidateGroup is the auto-grouping result for a .db file, consisting of
// one or more contiguous VideoSegments that share a recording session.
type CandidateGroup struct {
	AutoGroupKey    string         `json:"autoGroupKey"`
	Segments        []VideoSegment `json:"segments"`
	TotalDurationMs int64          `json:"totalDurationMs"`
	Codec           string         `json:"codec"`
	Compatible      bool           `json:"compatible"`
}

// Status describes the feature state reported to the frontend.
type Status struct {
	// Enabled is true when at least one source is registered. The UI uses
	// it to decide whether to show the "add source" empty state or the
	// normal groups/candidates UI.
	Enabled      bool      `json:"enabled"`
	Sources      []string  `json:"sources"`
	SegmentCount int       `json:"segmentCount"`
	LastScanAt   time.Time `json:"lastScanAt"`
	Scanning     bool      `json:"scanning"`
}

// sidecarEnvelope is the on-disk JSON shape.
type sidecarEnvelope struct {
	Version int          `json:"version"`
	GameID  string       `json:"gameId"`
	Groups  []VideoGroup `json:"groups"`
}

// IsCompatibleCodec reports whether a codec name is playable directly by
// HTML5 <video> across Chrome/Firefox/Safari without transcoding.
//
// Conservative whitelist: h264 and av1 are safe; vp9 works on Chromium and
// Firefox but not all Safari versions, so we still mark it compatible for
// MVP.  hevc/hvc1 is deliberately excluded because Firefox does not support
// it at all.
func IsCompatibleCodec(codec string) bool {
	switch strings.ToLower(codec) {
	case "h264", "avc1", "av1", "av01", "vp9", "vp09":
		return true
	}
	return false
}
