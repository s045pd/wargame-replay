package decoder

import (
	"encoding/hex"
	"testing"
)

func TestDecodePositionEntry(t *testing.T) {
	// Known entry: unit 45 (二班 中刀), bytes [0x2D, 0x00] = uint16LE 45
	// flags = [00 82 FD FE 01]: flags[0]=0 (dead), class=medic (0x82 & 0x07 = 2)
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
	// flags[0] = 0x00 → HP=0 (dead)
	if entry.HP != 0 {
		t.Errorf("expected HP 0, got %d", entry.HP)
	}
	if entry.Alive {
		t.Error("expected alive=false (flags[0]=0)")
	}
	// flags[1] = 0x82 → class = marksman (0x82 & 0x07 = 2)
	// Ground truth: 红方46号 = 二班 中刀 = 精确射手(marksman)
	if entry.Class != string(ClassMarksman) {
		t.Errorf("expected class marksman, got %s", entry.Class)
	}
	// flags[2]=0xFD=253 (ammo), flags[3]=0xFE=254 (bandage), flags[4]=0x01 (revival tokens)
	// supply = flags[1] upper 5 bits: (0x82 >> 3) & 0x1F = 16
	if entry.Ammo != 253 {
		t.Errorf("expected ammo 253, got %d", entry.Ammo)
	}
	if entry.Supply != 16 {
		t.Errorf("expected supply 16 (flags[1] upper 5 bits), got %d", entry.Supply)
	}
	if entry.Bandage != 254 {
		t.Errorf("expected bandage 254, got %d", entry.Bandage)
	}
	if entry.RevivalTokens != 1 {
		t.Errorf("expected revivalTokens 1, got %d", entry.RevivalTokens)
	}
}

func TestDecodePositionEntryAlive(t *testing.T) {
	// Unit 512 (KFN-马鸡, blue medic per ground truth)
	// flags = [64 84 EE FF 01]: flags[0]=0x64=100 (HP), class=medic (0x84 & 0x07 = 4)
	// Ground truth: 蓝方513号 = KFN-马鸡 = 医疗兵(medic)
	// flags[0] IS the actual HP value (0-100). 0x64=100 means full HP.
	raw, _ := hex.DecodeString("0002BA758F0CF11D8D116484EEFF01")
	entry := DecodePositionEntry(raw)
	if entry.ID != 512 {
		t.Errorf("expected ID 512, got %d", entry.ID)
	}
	if entry.Team != "blue" {
		t.Errorf("expected team blue, got %s", entry.Team)
	}
	if entry.HP != 100 {
		t.Errorf("expected HP 100 (flags[0]=0x64), got %d", entry.HP)
	}
	if !entry.Alive {
		t.Error("expected alive=true (flags[0]>0)")
	}
	if entry.Class != string(ClassMedic) {
		t.Errorf("expected class medic, got %s", entry.Class)
	}
	// flags[2]=0xEE=238 (ammo), flags[3]=0xFF=255 (bandage), flags[4]=0x01 (revival tokens)
	// supply = flags[1] upper 5 bits: (0x84 >> 3) & 0x1F = 16
	if entry.Ammo != 238 {
		t.Errorf("expected ammo 238, got %d", entry.Ammo)
	}
	if entry.Supply != 16 {
		t.Errorf("expected supply 16 (flags[1] upper 5 bits), got %d", entry.Supply)
	}
	if entry.Bandage != 255 {
		t.Errorf("expected bandage 255, got %d", entry.Bandage)
	}
	if entry.RevivalTokens != 1 {
		t.Errorf("expected revivalTokens 1, got %d", entry.RevivalTokens)
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

// TestDecodeDT8POIs validates the extended POI field parsing against
// ground-truth data from game 69 (2026-03-28 "输血行动") at 12:20:52.
func TestDecodeDT8POIs(t *testing.T) {
	// Raw DT8 blob extracted from the 3-28 database at 12:20:52.
	// Contains 12 POI entries (372 bytes / 31 bytes per entry).
	raw, _ := hex.DecodeString("000119ADA89D0CC4AED0110100FEFFFFFFFFFF00000000000000000000000001031465A79D0C61A4D0110500645D01000000000000000000000000000000020D1E0FB19D0CEFAFD01103020A003200570000000000000000000000000003021EACC39D0C38BBD01104020000000000000000000000000000000000000403141EA89D0CEBD7D0110501645D010000000000000000000000000000000501193EB59D0C83D5D0110101FEFFFFFFFFFF00000000000000000000000006021435AD9D0CF0C5D0110402006E0000000029000000000000000000000007021401B39D0C82BED0110402000C00000000000000000000000000000000080D1ECBBE9D0CC2CED01103020A003200004900000000000000000000000009060F7CB19D0C1CC9D01102011E00320064000000140100000000000000000A060FE2AD9D0C46BAD011020028005000640000001E0200000000000000000B060F96AD9D0C5EC0D01102011E003200640000004D020000000000000000")

	pois := DecodeDT8POIs(raw)

	// Find POIs by ID for targeted assertions
	poiByID := make(map[int]POIObject)
	for _, p := range pois {
		poiByID[p.ID] = p
	}

	// Entry 10 = H10: Red 兵站 (type 2).
	// Ground truth: lives=40, supplies=80, health=100%, buildTimer=542s
	fob := poiByID[10]
	if fob.Type != POIVehicle {
		t.Errorf("H10: expected type %d (兵站), got %d", POIVehicle, fob.Type)
	}
	if fob.Lives != 40 {
		t.Errorf("H10 lives: expected 40, got %d", fob.Lives)
	}
	if fob.Supplies != 80 {
		t.Errorf("H10 supplies: expected 80, got %d", fob.Supplies)
	}
	if fob.Health != 100 {
		t.Errorf("H10 health: expected 100, got %d", fob.Health)
	}
	if fob.BuildTimer != 542 {
		t.Errorf("H10 buildTimer: expected 542, got %d", fob.BuildTimer)
	}

	// Entry 1 = C12: Red 防御点 (type 5).
	// Ground truth: health=100%, heldTime=349s (00:05:49)
	sta := poiByID[1]
	if sta.Type != POIStation {
		t.Errorf("C12: expected type %d (防御点), got %d", POIStation, sta.Type)
	}
	if sta.Health != 100 {
		t.Errorf("C12 health: expected 100, got %d", sta.Health)
	}
	if sta.HeldTime != 349 {
		t.Errorf("C12 heldTime: expected 349 (5:49), got %d", sta.HeldTime)
	}

	// Entry 7 = I9: Control point (type 4).
	// Ground truth: redPct=0%, bluePct=12%
	ctrl := poiByID[7]
	if ctrl.Type != POIControlPoint {
		t.Errorf("I9: expected type %d (控制点), got %d", POIControlPoint, ctrl.Type)
	}
	if ctrl.RedPct != 0 {
		t.Errorf("I9 redPct: expected 0, got %d", ctrl.RedPct)
	}
	if ctrl.BluePct != 12 {
		t.Errorf("I9 bluePct: expected 12, got %d", ctrl.BluePct)
	}

	// Entry 8 = M5: 补给站 (type 3).
	// Ground truth: lives=10, supplies=50, redPct=0%, bluePct=73%
	sup := poiByID[8]
	if sup.Type != POISupplyCache {
		t.Errorf("M5: expected type %d (补给站), got %d", POISupplyCache, sup.Type)
	}
	if sup.Lives != 10 {
		t.Errorf("M5 lives: expected 10, got %d", sup.Lives)
	}
	if sup.Supplies != 50 {
		t.Errorf("M5 supplies: expected 50, got %d", sup.Supplies)
	}
	if sup.RedPct != 0 {
		t.Errorf("M5 redPct: expected 0, got %d", sup.RedPct)
	}
	if sup.BluePct != 73 {
		t.Errorf("M5 bluePct: expected 73, got %d", sup.BluePct)
	}

	// Entry 3 = H4: Control point (type 4), not yet contested.
	ctrl2 := poiByID[3]
	if ctrl2.RedPct != 0 || ctrl2.BluePct != 0 {
		t.Errorf("H4: expected 0%%/0%%, got red=%d%% blue=%d%%", ctrl2.RedPct, ctrl2.BluePct)
	}
}
