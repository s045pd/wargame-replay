package video

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestSidecar(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	return filepath.Join(dir, "game.db")
}

func sampleGroup(relPath string, unitID int) VideoGroup {
	return VideoGroup{
		UnitID:      unitID,
		CameraLabel: "Head FPV",
		OffsetMs:    -1234,
		Segments: []VideoSegment{
			{
				RelPath:    relPath,
				StartTs:    time.Unix(1700000000, 0).UTC(),
				DurationMs: 60000,
				Codec:      "h264",
				Width:      1920,
				Height:     1080,
				Compatible: true,
			},
		},
	}
}

func TestSidecarLoadMissingFile(t *testing.T) {
	dbPath := newTestSidecar(t)
	groups, err := LoadSidecar(dbPath)
	if err != nil {
		t.Fatalf("load missing: %v", err)
	}
	if groups != nil {
		t.Errorf("want nil, got %v", groups)
	}
}

func TestSidecarSaveLoad(t *testing.T) {
	dbPath := newTestSidecar(t)
	in := []VideoGroup{
		{ID: "one", UnitID: 42, CameraLabel: "A", Segments: []VideoSegment{{RelPath: "a.mp4"}}},
		{ID: "two", UnitID: 501, CameraLabel: "B", Segments: []VideoSegment{{RelPath: "b.mp4"}}},
	}
	if err := SaveSidecar(dbPath, "gameid", in); err != nil {
		t.Fatal(err)
	}
	got, err := LoadSidecar(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d groups", len(got))
	}
	if got[0].ID != "one" || got[1].ID != "two" {
		t.Errorf("unexpected ids: %+v", got)
	}

	// Sidecar file should exist on disk.
	if _, err := os.Stat(SidecarPath(dbPath)); err != nil {
		t.Errorf("sidecar file missing: %v", err)
	}
}

func TestSidecarSaveEmptyRemovesFile(t *testing.T) {
	dbPath := newTestSidecar(t)
	// First write something.
	if err := SaveSidecar(dbPath, "g", []VideoGroup{sampleGroup("a.mp4", 1)}); err != nil {
		t.Fatal(err)
	}
	// Now save empty.
	if err := SaveSidecar(dbPath, "g", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(SidecarPath(dbPath)); !os.IsNotExist(err) {
		t.Errorf("sidecar should be gone, stat err = %v", err)
	}
	// Loading returns nil without error.
	got, err := LoadSidecar(dbPath)
	if err != nil || got != nil {
		t.Errorf("load after remove: %v %v", got, err)
	}
}

func TestSidecarAddGroupGeneratesID(t *testing.T) {
	dbPath := newTestSidecar(t)
	g, err := AddGroup(dbPath, "game1", sampleGroup("a.mp4", 42))
	if err != nil {
		t.Fatal(err)
	}
	if len(g.ID) == 0 {
		t.Fatalf("expected id to be generated")
	}
	if g.CreatedAt.IsZero() || g.UpdatedAt.IsZero() {
		t.Errorf("expected timestamps to be set")
	}
	got, _ := LoadSidecar(dbPath)
	if len(got) != 1 || got[0].ID != g.ID {
		t.Errorf("round-trip mismatch")
	}
}

func TestSidecarAddMultiplePreservesOrder(t *testing.T) {
	dbPath := newTestSidecar(t)
	g1, _ := AddGroup(dbPath, "g", sampleGroup("a.mp4", 1))
	g2, _ := AddGroup(dbPath, "g", sampleGroup("b.mp4", 2))
	got, _ := LoadSidecar(dbPath)
	if len(got) != 2 {
		t.Fatalf("len = %d", len(got))
	}
	if got[0].ID != g1.ID || got[1].ID != g2.ID {
		t.Errorf("order not preserved")
	}
}

func TestSidecarUpdateGroup(t *testing.T) {
	dbPath := newTestSidecar(t)
	g, _ := AddGroup(dbPath, "g", sampleGroup("a.mp4", 42))
	orig := g.UpdatedAt
	time.Sleep(5 * time.Millisecond)
	err := UpdateGroup(dbPath, "g", g.ID, func(patch *VideoGroup) {
		patch.OffsetMs = 9999
		patch.CameraLabel = "renamed"
	})
	if err != nil {
		t.Fatal(err)
	}
	got, _ := LoadSidecar(dbPath)
	if got[0].OffsetMs != 9999 {
		t.Errorf("offset not updated: %d", got[0].OffsetMs)
	}
	if got[0].CameraLabel != "renamed" {
		t.Errorf("label not updated: %s", got[0].CameraLabel)
	}
	if !got[0].UpdatedAt.After(orig) {
		t.Errorf("updatedAt not advanced")
	}
}

func TestSidecarUpdateMissing(t *testing.T) {
	dbPath := newTestSidecar(t)
	err := UpdateGroup(dbPath, "g", "nonexistent", func(*VideoGroup) {})
	if err == nil {
		t.Fatalf("expected error for missing id")
	}
}

func TestSidecarDeleteGroup(t *testing.T) {
	dbPath := newTestSidecar(t)
	g1, _ := AddGroup(dbPath, "g", sampleGroup("a.mp4", 1))
	g2, _ := AddGroup(dbPath, "g", sampleGroup("b.mp4", 2))

	if err := DeleteGroup(dbPath, "g", g1.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := LoadSidecar(dbPath)
	if len(got) != 1 || got[0].ID != g2.ID {
		t.Errorf("delete didn't leave g2 alone: %+v", got)
	}

	if err := DeleteGroup(dbPath, "g", g2.ID); err != nil {
		t.Fatal(err)
	}
	// Last group removed → file should be gone.
	if _, err := os.Stat(SidecarPath(dbPath)); !os.IsNotExist(err) {
		t.Errorf("file should be removed")
	}
}

func TestSidecarDeleteMissing(t *testing.T) {
	dbPath := newTestSidecar(t)
	if err := DeleteGroup(dbPath, "g", "nope"); err == nil {
		t.Fatal("expected error")
	}
}

func TestNewUUIDv4Format(t *testing.T) {
	s, err := newUUIDv4()
	if err != nil {
		t.Fatal(err)
	}
	// Expected shape: 8-4-4-4-12 hex chars.
	if len(s) != 36 {
		t.Fatalf("len = %d, want 36; got %q", len(s), s)
	}
	if s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		t.Errorf("dashes in wrong place: %q", s)
	}
	// Version 4: the 14th char (after the second dash) must be '4'.
	if s[14] != '4' {
		t.Errorf("version digit not 4: %q", s)
	}
	// Variant: 19th char must be in {8,9,a,b}.
	switch s[19] {
	case '8', '9', 'a', 'b':
	default:
		t.Errorf("variant digit not 8/9/a/b: %q", s)
	}
}

func TestNewUUIDv4Unique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		s, err := newUUIDv4()
		if err != nil {
			t.Fatal(err)
		}
		if seen[s] {
			t.Fatalf("collision on %s", s)
		}
		seen[s] = true
	}
}
