package decoder

import (
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestDecodeKillEvents(t *testing.T) {
	db := openTestDB(t)
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
