package video

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScannerDisabled(t *testing.T) {
	// Empty dataDir + no sources → feature is disabled but scanner is safe to call.
	s := NewScanner("")
	if s.Enabled() {
		t.Fatalf("scanner with no sources should report disabled")
	}
	if err := s.Scan(); err != nil {
		t.Fatalf("Scan on scanner with no sources returned error: %v", err)
	}
	if s.Index().Count() != 0 {
		t.Fatalf("index should be empty")
	}
	st := s.Status()
	if st.Enabled {
		t.Errorf("status.enabled = true, want false")
	}
}

func TestScannerWithTestdata(t *testing.T) {
	if _, err := os.Stat(tinyFixturePath); err != nil {
		t.Skipf("fixture missing: %v", err)
	}
	dataDir := t.TempDir()
	abs, err := filepath.Abs("testdata")
	if err != nil {
		t.Fatal(err)
	}
	s := NewScannerWithInitial(dataDir, abs)
	if !s.Enabled() {
		t.Fatal("scanner should be enabled after seeding with testdata source")
	}
	// NewScannerWithInitial already adds the source but does not scan;
	// kick off an explicit scan so the index populates.
	if err := s.Scan(); err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if s.Index().Count() < 1 {
		t.Fatalf("expected at least 1 entry, got %d", s.Index().Count())
	}
	tinyAbs, err := filepath.Abs(tinyFixturePath)
	if err != nil {
		t.Fatal(err)
	}
	e, ok := s.Index().Lookup(tinyAbs)
	if !ok {
		t.Fatalf("lookup for %s failed", tinyAbs)
	}
	if e.Codec != "h264" {
		t.Errorf("codec = %s, want h264", e.Codec)
	}
	if e.DurationMs == 0 {
		t.Errorf("durationMs is 0")
	}
	if e.FileSizeBytes == 0 {
		t.Errorf("fileSizeBytes is 0")
	}
	st := s.Status()
	if !st.Enabled || st.SegmentCount != s.Index().Count() {
		t.Errorf("status mismatch: %+v", st)
	}
}

func TestIsVideoExt(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{"foo.mp4", true},
		{"foo.MP4", true},
		{"foo.m4v", true},
		{"foo.mov", true},
		{"foo.mkv", false},
		{"foo.txt", false},
		{"foo", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := isVideoExt(tc.path); got != tc.want {
			t.Errorf("isVideoExt(%q) = %v, want %v", tc.path, got, tc.want)
		}
	}
}
