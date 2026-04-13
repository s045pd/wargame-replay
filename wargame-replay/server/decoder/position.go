package decoder

import (
	"encoding/binary"
	"fmt"
)

const entrySize = 15

// DataType=8 entry size: 31 bytes per unit (world state / secondary position source)
const dt8EntrySize = 31

func DecodePositionEntry(data []byte) UnitPosition {
	if len(data) < entrySize {
		return UnitPosition{}
	}
	// Bytes 0-1: uint16LE unit ID (matches tag table SrcIndex)
	unitID := binary.LittleEndian.Uint16(data[0:2])
	rawLat := binary.LittleEndian.Uint32(data[2:6])
	rawLng := binary.LittleEndian.Uint32(data[6:10])
	flags := make([]byte, 5)
	copy(flags, data[10:15])

	// flags[0] = HP value (0-100). 0 means dead.
	// flags[1] low 3 bits = unit class: 0=rifle, 1=mg, 2=marksman, 3=sniper, 4=medic
	// flags[2] = ammo (0-255, depletes on fire, resets on resupply)
	// flags[3] = bandage (0-255 raw value, similar scaling to ammo)
	// flags[4] = revival tokens (0-2, decremented on use, resets on resupply)
	hp := int(flags[0])
	alive := hp > 0

	return UnitPosition{
		ID:            unitID,
		RawLat:        rawLat,
		RawLng:        rawLng,
		Flags:         flags,
		FlagsHex:      fmt.Sprintf("%x", flags),
		Team:          decodeTeam(unitID),
		Alive:         alive,
		HP:            hp,
		Ammo:          int(flags[2]),
		Supply:        int((flags[1] >> 3) & 0x1F), // upper 5 bits of class byte
		Bandage:       int(flags[3]),
		RevivalTokens: int(flags[4]),
		Class:         decodeClass(flags),
	}
}

func DecodePositionFrame(data []byte) []UnitPosition {
	count := len(data) / entrySize
	units := make([]UnitPosition, 0, count)
	for i := 0; i < count; i++ {
		entry := DecodePositionEntry(data[i*entrySize : (i+1)*entrySize])
		units = append(units, entry)
	}
	return units
}

// DecodeDT8POIs decodes a DataType=8 blob as battlefield POI objects.
// DT8 entries are 31 bytes each. byte[11] identifies the POI type (1-5).
//
// Per-type byte layout (bytes 13-30, relative to entry start):
//
//	Type 1 (BaseCamp):  [13]=HP(0xFE=invincible), [14:19]=0xFF
//	Type 2 (兵站/FOB):  [13]=lives, [15]=supplies, [17]=health%, [21:23 LE]=buildTimer(sec)
//	Type 3 (补给站):    [13]=lives, [15]=supplies, [17]=redPct, [18]=bluePct, [23:25 LE]=heldTime(sec)
//	Type 4 (控制点):    [13]=redPct, [14]=bluePct, [15:17 LE]=redHeld(sec), [19:21 LE]=blueHeld(sec)
//	Type 5 (防御点):    [13]=health%, [14:16 LE]=heldTime(sec)
func DecodeDT8POIs(data []byte) []POIObject {
	count := len(data) / dt8EntrySize
	pois := make([]POIObject, 0, count)
	for i := 0; i < count; i++ {
		entry := data[i*dt8EntrySize : (i+1)*dt8EntrySize]
		if len(entry) < dt8EntrySize {
			continue
		}
		rawLat := binary.LittleEndian.Uint32(entry[3:7])
		rawLng := binary.LittleEndian.Uint32(entry[7:11])
		if rawLat == 0 && rawLng == 0 {
			continue
		}
		poiType := POIType(entry[11])
		if poiType < POIBaseCamp || poiType > POIStation {
			continue // not a known POI type
		}
		poi := POIObject{
			ID:       int(entry[0]),
			Type:     poiType,
			Team:     int(entry[12]),
			Resource: int(entry[13]),
		}

		// Decode type-specific extended fields
		switch poiType {
		case POIVehicle: // type 2: 兵站 (FOB)
			poi.Lives = int(entry[13])
			poi.Supplies = int(entry[15])
			poi.Health = int(entry[17])
			poi.BuildTimer = int(binary.LittleEndian.Uint16(entry[21:23]))
		case POISupplyCache: // type 3: 补给站
			poi.Lives = int(entry[13])
			poi.Supplies = int(entry[15])
			poi.RedPct = int(entry[17])
			poi.BluePct = int(entry[18])
			poi.HeldTime = int(binary.LittleEndian.Uint16(entry[23:25]))
		case POIControlPoint: // type 4: 控制点
			poi.RedPct = int(entry[13])
			poi.BluePct = int(entry[14])
			poi.RedHeld = int(binary.LittleEndian.Uint16(entry[15:17]))
			poi.BlueHeld = int(binary.LittleEndian.Uint16(entry[19:21]))
		case POIStation: // type 5: 防御点
			poi.Health = int(entry[13])
			poi.HeldTime = int(binary.LittleEndian.Uint16(entry[14:16]))
		}

		// Store raw coords temporarily — caller must convert
		poi.Lat = float64(rawLat)
		poi.Lng = float64(rawLng)
		pois = append(pois, poi)
	}
	return pois
}

// decodeTeam determines team by unit ID range from the tag table data:
//   - ID 0-499: Red team (squads 1-6, various sub-teams)
//   - ID 500-699: Blue team (KFN, AME, IAYF, TQG organizations)
func decodeTeam(unitID uint16) string {
	id := int(unitID)
	if id < 500 {
		return "red"
	}
	return "blue"
}

// decodeClass extracts unit class from flags[1] lower 3 bits.
//
//	0 = rifle, 1 = mg, 2 = marksman, 3 = sniper, 4 = medic
//
// Verified 100% match (136/136) against authoritative game roster data.
func decodeClass(flags []byte) string {
	if len(flags) >= 2 {
		switch flags[1] & 0x07 {
		case 1:
			return string(ClassMG)
		case 2:
			return string(ClassMarksman)
		case 3:
			return string(ClassSniper)
		case 4:
			return string(ClassMedic)
		}
	}
	return string(ClassRifle)
}
