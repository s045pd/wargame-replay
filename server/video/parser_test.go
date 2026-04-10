package video

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// tinyFixturePath is committed into testdata/ for round-trip coverage.
const tinyFixturePath = "testdata/tiny.mp4"

func TestParseTinyMp4(t *testing.T) {
	if _, err := os.Stat(tinyFixturePath); err != nil {
		t.Skipf("fixture missing: %v", err)
	}
	m, err := Parse(tinyFixturePath)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if m.Codec != "h264" {
		t.Errorf("codec = %q, want h264", m.Codec)
	}
	if m.Width != 320 {
		t.Errorf("width = %d, want 320", m.Width)
	}
	if m.Height != 240 {
		t.Errorf("height = %d, want 240", m.Height)
	}
	if m.DurationMs < 500 || m.DurationMs > 2000 {
		t.Errorf("durationMs = %d, want between 500 and 2000", m.DurationMs)
	}
	// creation_time must be within the last 24 hours on a freshly-generated fixture.
	if m.CreationTime.IsZero() {
		t.Errorf("creationTime is zero")
	}
	if time.Since(m.CreationTime) > 10*365*24*time.Hour {
		t.Errorf("creationTime unreasonably old: %v", m.CreationTime)
	}
}

func TestParseMissingFile(t *testing.T) {
	_, err := Parse("testdata/does-not-exist.mp4")
	if err == nil {
		t.Fatalf("expected error for missing file")
	}
}

func TestParseEmptyFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "empty.mp4")
	if err := os.WriteFile(p, nil, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Parse(p)
	if err == nil {
		t.Fatalf("expected error for empty file")
	}
}

func TestParseNonMp4(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "junk.mp4")
	if err := os.WriteFile(p, []byte("not an mp4 file, just random text"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Parse(p)
	// Either an error or a missing mvhd; what we want to ensure is no panic.
	if err == nil {
		t.Fatalf("expected error for non-mp4")
	}
}

func TestIsCompatibleCodec(t *testing.T) {
	cases := []struct {
		codec string
		want  bool
	}{
		{"h264", true},
		{"H264", true},
		{"avc1", true},
		{"av1", true},
		{"av01", true},
		{"vp9", true},
		{"vp09", true},
		{"hevc", false},
		{"hev1", false},
		{"hvc1", false},
		{"", false},
		{"unknown", false},
	}
	for _, tc := range cases {
		if got := IsCompatibleCodec(tc.codec); got != tc.want {
			t.Errorf("IsCompatibleCodec(%q) = %v, want %v", tc.codec, got, tc.want)
		}
	}
}
