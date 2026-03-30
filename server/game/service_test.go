package game

import (
	"testing"
)

func TestLoadGame(t *testing.T) {
	svc, err := LoadGame("../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db")
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()

	meta := svc.Meta()
	if meta.CoordMode == "" {
		t.Error("expected coordMode")
	}
	if len(meta.Players) == 0 {
		t.Error("expected players")
	}
	t.Logf("CoordMode: %s, Players: %d, TimeRange: %s to %s",
		meta.CoordMode, len(meta.Players), meta.StartTime, meta.EndTime)

	// Test frame query
	frame, err := svc.GetFrame("2026-01-17 12:00:00")
	if err != nil {
		t.Fatal(err)
	}
	if len(frame.Units) == 0 {
		t.Error("expected units in frame")
	}
	t.Logf("Frame at 12:00: %d units", len(frame.Units))
}
