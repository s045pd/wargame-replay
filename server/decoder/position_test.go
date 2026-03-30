package decoder

import (
	"encoding/hex"
	"testing"
)

func TestDecodePositionEntry(t *testing.T) {
	// Known entry: unit 45 (清木), type=0
	raw, _ := hex.DecodeString("2D006A588F0CF3008D110082FDFE01")
	if len(raw) != 15 {
		t.Fatalf("expected 15 bytes, got %d", len(raw))
	}
	entry := DecodePositionEntry(raw)
	if entry.ID != 45 {
		t.Errorf("expected ID 45, got %d", entry.ID)
	}
	if entry.UnitType != 0 {
		t.Errorf("expected type 0, got %d", entry.UnitType)
	}
	if entry.RawLat == 0 || entry.RawLng == 0 {
		t.Error("expected non-zero raw coordinates")
	}
}

func TestDecodePositionFrame(t *testing.T) {
	// 210 bytes = 14 entries
	raw, _ := hex.DecodeString(
		"0602AC528F0C19F08C116480EEFE01" +
			"2D006A588F0CF3008D110082FDFE01" +
			"3500F45C8F0C79028D116482FEFE01" +
			"230085588F0C07018D110082FDFE01" +
			"2C00F65C8F0C79028D116482FEFE01" +
			"25005D588F0CF3008D110082FDFE01" +
			"2A0053588F0C1A018D113282FDFE01" +
			"44006A5B8F0C9E018D116482FEFE01" +
			"460071638F0C610C8D116482FEFE01" +
			"36001E5D8F0C92028D116483FEFE01" +
			"3E00F65B8F0CFA018D116482FEFE01" +
			"2F00BF4B8F0C12FB8C116480EEFE01" +
			"0002BA758F0CF11D8D116484EEFF01" +
			"0C02C3528F0CDFEF8C116480EEFE01")
	units := DecodePositionFrame(raw)
	if len(units) != 14 {
		t.Fatalf("expected 14 units, got %d", len(units))
	}
	// Check unit 45 (清木) is in the list
	found := false
	for _, u := range units {
		if u.ID == 45 {
			found = true
			if u.UnitType != 0 {
				t.Errorf("unit 45 type: expected 0, got %d", u.UnitType)
			}
		}
	}
	if !found {
		t.Error("unit 45 not found in decoded frame")
	}
}
