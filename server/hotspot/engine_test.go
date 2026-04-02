package hotspot

import (
	"os"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
	"wargame-replay/server/decoder"
)

const testDBPath = "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db"

func TestDetectHotspotEvents(t *testing.T) {
	if _, err := os.Stat(testDBPath); err != nil {
		t.Skip("test db not found:", testDBPath)
	}
	db, err := sql.Open("sqlite3", testDBPath+"?mode=ro")
	if err != nil {
		t.Skip("cannot open test db:", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		t.Skip("test db not accessible:", err)
	}

	resolver, _, err := decoder.AutoDetectCoords(db, testDBPath)
	if err != nil {
		t.Fatalf("AutoDetectCoords: %v", err)
	}
	combatEvents, err := decoder.LoadAllEvents(db)
	if err != nil {
		t.Fatalf("LoadAllEvents: %v", err)
	}
	bombingEvents, _ := decoder.LoadBombingEvents(db)
	for i := range bombingEvents {
		lat, lng := resolver.Convert(bombingEvents[i].RawLat, bombingEvents[i].RawLng)
		bombingEvents[i].Lat = lat
		bombingEvents[i].Lng = lng
	}

	events := DetectHotspotEvents(db, resolver, combatEvents, bombingEvents)
	if len(events) == 0 {
		t.Fatal("expected non-empty hotspot events")
	}
	t.Logf("Detected %d hotspot events", len(events))
	for _, h := range events {
		t.Logf("  #%d [%s] %s  score=%.1f  kills=%d hits=%d  units=%d  %s..%s",
			h.ID, h.Type, h.Label, h.Score, h.Kills, h.Hits, len(h.Units), h.StartTs, h.EndTs)
	}
}
