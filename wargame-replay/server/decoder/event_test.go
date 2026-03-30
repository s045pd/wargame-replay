package decoder

import (
	"database/sql"
	"testing"
	_ "github.com/mattn/go-sqlite3"
)

func TestDecodeKillEvents(t *testing.T) {
	db, err := sql.Open("sqlite3", "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db?mode=ro")
	if err != nil {
		t.Skip("test db not found")
	}
	defer db.Close()

	events, err := LoadAllEvents(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) == 0 {
		t.Error("expected some events")
	}
	t.Logf("Loaded %d events", len(events))
	for i, e := range events {
		if i < 5 {
			t.Logf("  %s: %s src=%d dst=%d", e.Ts, e.Type, e.SrcID, e.DstID)
		}
	}
}
