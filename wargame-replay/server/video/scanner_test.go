package video

import (
	"os"
	"testing"
)

func TestScannerDisabled(t *testing.T) {
	s := NewScanner("")
	if s.Enabled() {
		t.Fatalf("empty root should be disabled")
	}
	if err := s.Scan(); err != nil {
		t.Fatalf("Scan on disabled scanner returned error: %v", err)
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
	s := NewScanner("testdata")
	if !s.Enabled() {
		t.Fatal("scanner should be enabled")
	}
	if err := s.Scan(); err != nil {
		t.Fatalf("Scan: %v", err)
	}
	if s.Index().Count() < 1 {
		t.Fatalf("expected at least 1 entry, got %d", s.Index().Count())
	}
	e, ok := s.Index().Lookup("tiny.mp4")
	if !ok {
		t.Fatalf("lookup for tiny.mp4 failed")
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
