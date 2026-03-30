package hotspot

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"wargame-replay/server/decoder"
	"wargame-replay/server/index"
)

func TestComputeHotspots(t *testing.T) {
	db, err := sql.Open("sqlite3", "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db?mode=ro")
	if err != nil {
		t.Skip("test db not found")
	}
	defer db.Close()

	// Verify db is usable; skip if file is absent.
	if err := db.Ping(); err != nil {
		t.Skip("test db not accessible: " + err.Error())
	}

	idx, err := index.BuildTimeIndex(db)
	if err != nil {
		t.Fatalf("BuildTimeIndex: %v", err)
	}
	resolver, _, err := decoder.AutoDetectCoords(db)
	if err != nil {
		t.Fatalf("AutoDetectCoords: %v", err)
	}
	events, err := decoder.LoadAllEvents(db)
	if err != nil {
		t.Fatalf("LoadAllEvents: %v", err)
	}

	frames, err := ComputeHotspots(db, idx, resolver, events)
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) == 0 {
		t.Fatal("expected non-empty hotspot timeline")
	}
	t.Logf("Computed %d hotspot frames", len(frames))

	// Validate score range on every frame.
	for i, f := range frames {
		if f.MaxScore < 0 || f.MaxScore > 1 {
			t.Errorf("frame %d score out of [0,1] range: %f", i, f.MaxScore)
		}
	}
}
