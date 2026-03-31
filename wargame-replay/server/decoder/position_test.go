package decoder

import (
	"encoding/hex"
	"testing"
)

func TestDecodePositionEntry(t *testing.T) {
	// Known entry: unit 45 (二班 中刀), bytes [0x2D, 0x00] = uint16LE 45
	raw, _ := hex.DecodeString("2D006A588F0CF3008D110082FDFE01")
	if len(raw) != 15 {
		t.Fatalf("expected 15 bytes, got %d", len(raw))
	}
	entry := DecodePositionEntry(raw)
	if entry.ID != 45 {
		t.Errorf("expected ID 45, got %d", entry.ID)
	}
	if entry.RawLat == 0 || entry.RawLng == 0 {
		t.Error("expected non-zero raw coordinates")
	}
	if entry.Team != "red" {
		t.Errorf("expected team red, got %s", entry.Team)
	}
}

func TestDecodePositionFrame(t *testing.T) {
	// 210 bytes = 14 entries
	raw, _ := hex.DecodeString(
		"0602AC528F0C19F08C116480EEFE01" + // ID=518 (栯堂, blue)
			"2D006A588F0CF3008D110082FDFE01" + // ID=45 (二班 中刀, red)
			"3500F45C8F0C79028D116482FEFE01" + // ID=53
			"230085588F0C07018D110082FDFE01" + // ID=35
			"2C00F65C8F0C79028D116482FEFE01" + // ID=44
			"25005D588F0CF3008D110082FDFE01" + // ID=37
			"2A0053588F0C1A018D113282FDFE01" + // ID=42
			"44006A5B8F0C9E018D116482FEFE01" + // ID=68
			"460071638F0C610C8D116482FEFE01" + // ID=70
			"36001E5D8F0C92028D116483FEFE01" + // ID=54
			"3E00F65B8F0CFA018D116482FEFE01" + // ID=62
			"2F00BF4B8F0C12FB8C116480EEFE01" + // ID=47
			"0002BA758F0CF11D8D116484EEFF01" + // ID=512 (KFN-马鸡, blue)
			"0C02C3528F0CDFEF8C116480EEFE01") // ID=524
	units := DecodePositionFrame(raw)
	if len(units) != 14 {
		t.Fatalf("expected 14 units, got %d", len(units))
	}

	// Check unit 45 (红 team) is in the list
	found45 := false
	for _, u := range units {
		if u.ID == 45 {
			found45 = true
			if u.Team != "red" {
				t.Errorf("unit 45 team: expected red, got %s", u.Team)
			}
		}
	}
	if !found45 {
		t.Error("unit 45 not found in decoded frame")
	}

	// Check unit 518 (蓝 team) — bytes [0x06, 0x02] = uint16LE 518
	found518 := false
	for _, u := range units {
		if u.ID == 518 {
			found518 = true
			if u.Team != "blue" {
				t.Errorf("unit 518 team: expected blue, got %s", u.Team)
			}
		}
	}
	if !found518 {
		t.Error("unit 518 not found — uint16LE ID decoding may be wrong")
	}

	// Check unit 512 (蓝 team) — bytes [0x00, 0x02] = uint16LE 512
	found512 := false
	for _, u := range units {
		if u.ID == 512 {
			found512 = true
			if u.Team != "blue" {
				t.Errorf("unit 512 team: expected blue, got %s", u.Team)
			}
		}
	}
	if !found512 {
		t.Error("unit 512 not found — uint16LE ID decoding may be wrong")
	}
}
