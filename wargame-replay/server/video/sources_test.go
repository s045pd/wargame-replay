package video

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestSourcesLoadMissing(t *testing.T) {
	dir := t.TempDir()
	got, err := loadSources(dir)
	if err != nil {
		t.Fatalf("load missing: %v", err)
	}
	if got != nil {
		t.Errorf("want nil, got %v", got)
	}
}

func TestSourcesRoundTrip(t *testing.T) {
	dir := t.TempDir()
	want := []string{"/tmp/a", "/mnt/b", "/Users/jane/videos"}
	if err := saveSources(dir, want); err != nil {
		t.Fatal(err)
	}
	got, err := loadSources(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("got %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("sources[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestSourcesSaveEmptyRemovesFile(t *testing.T) {
	dir := t.TempDir()
	if err := saveSources(dir, []string{"/tmp/a"}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, sourcesFilename)); err != nil {
		t.Fatalf("file should exist: %v", err)
	}
	if err := saveSources(dir, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, sourcesFilename)); !os.IsNotExist(err) {
		t.Errorf("file should be gone, stat err = %v", err)
	}
}

func TestSourcesBadJsonReturnsError(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, sourcesFilename), []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := loadSources(dir)
	if err == nil {
		t.Fatalf("expected error for bad json")
	}
}

func TestScannerAddRemoveSource(t *testing.T) {
	dataDir := t.TempDir()
	sourceA := t.TempDir()
	sourceB := t.TempDir()

	s := NewScanner(dataDir)
	if s.Enabled() {
		t.Fatal("should start disabled")
	}

	// Add A
	absA, err := s.AddSource(sourceA)
	if err != nil {
		t.Fatalf("AddSource A: %v", err)
	}
	if !s.Enabled() {
		t.Error("should be enabled after first AddSource")
	}
	if len(s.Sources()) != 1 {
		t.Errorf("sources count = %d, want 1", len(s.Sources()))
	}

	// Adding again is idempotent
	_, err = s.AddSource(sourceA)
	if err != nil {
		t.Fatalf("idempotent add: %v", err)
	}
	if len(s.Sources()) != 1 {
		t.Errorf("duplicate add changed count")
	}

	// Add B
	_, err = s.AddSource(sourceB)
	if err != nil {
		t.Fatalf("AddSource B: %v", err)
	}
	if len(s.Sources()) != 2 {
		t.Errorf("sources count = %d, want 2", len(s.Sources()))
	}

	// Persistence: new scanner loads the same list
	s2 := NewScanner(dataDir)
	if len(s2.Sources()) != 2 {
		t.Errorf("persisted sources count = %d, want 2", len(s2.Sources()))
	}

	// Remove A by its canonical path
	if err := s.RemoveSource(absA); err != nil {
		t.Fatalf("RemoveSource A: %v", err)
	}
	if len(s.Sources()) != 1 {
		t.Errorf("after remove count = %d, want 1", len(s.Sources()))
	}

	// Removing again returns ErrSourceUnknown
	if err := s.RemoveSource(absA); !errors.Is(err, ErrSourceUnknown) {
		t.Errorf("expected ErrSourceUnknown, got %v", err)
	}
}

func TestScannerAddInvalidSource(t *testing.T) {
	s := NewScanner(t.TempDir())
	cases := []struct {
		name string
		path string
	}{
		{"empty", ""},
		{"nonexistent", "/definitely/does/not/exist/anywhere"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := s.AddSource(tc.path); err == nil {
				t.Errorf("expected error for %q", tc.path)
			}
		})
	}
}

func TestScannerAddSourceRejectsFile(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "not-a-dir.txt")
	if err := os.WriteFile(file, []byte("hi"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewScanner(t.TempDir())
	if _, err := s.AddSource(file); err == nil {
		t.Errorf("expected error for file path")
	}
}

func TestIsInsideSource(t *testing.T) {
	dir := t.TempDir()
	inside := filepath.Join(dir, "sub", "file.mp4")
	if err := os.MkdirAll(filepath.Dir(inside), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inside, []byte{0}, 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "other.mp4")
	if err := os.WriteFile(outside, []byte{0}, 0o644); err != nil {
		t.Fatal(err)
	}

	s := NewScanner(t.TempDir())
	if _, err := s.AddSource(dir); err != nil {
		t.Fatal(err)
	}

	if !s.IsInsideSource(inside) {
		t.Errorf("inside path should be allowed")
	}
	if s.IsInsideSource(outside) {
		t.Errorf("outside path should be rejected")
	}
}
