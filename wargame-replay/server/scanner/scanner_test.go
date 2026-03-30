package scanner

import (
	"testing"
)

func TestParseFilename(t *testing.T) {
	info, err := ParseFilename("9_2026-01-17-11-40-00_2026-01-17-20-00-11.db")
	if err != nil {
		t.Fatal(err)
	}
	if info.Session != "9" {
		t.Errorf("expected session 9, got %s", info.Session)
	}
	if info.StartTime != "2026-01-17 11:40:00" {
		t.Errorf("unexpected start time: %s", info.StartTime)
	}
	if info.EndTime != "2026-01-17 20:00:11" {
		t.Errorf("unexpected end time: %s", info.EndTime)
	}
	if len(info.ID) != 8 {
		t.Errorf("expected 8-char ID, got %s", info.ID)
	}
}

func TestScanDirectory(t *testing.T) {
	// Uses the real test DB at repo root
	games, err := ScanDirectory("../../../")
	if err != nil {
		t.Fatal(err)
	}
	if len(games) == 0 {
		t.Fatal("expected at least 1 game")
	}
	if games[0].PlayerCount == 0 {
		t.Error("expected non-zero player count")
	}
}
