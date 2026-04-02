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

	// flags[0] is an alive/dead indicator: >0 means alive, 0 means dead.
	// It is NOT the actual HP value — real HP comes from the event timeline.
	// flags[1] low 3 bits = unit class: 0=rifle, 1=mg, 2=marksman, 3=sniper, 4=medic
	// flags[2] = ammo (0-255, depletes on fire, resets on resupply)
	// flags[3] = supply / grenades (discrete values, depletes in steps of ~5)
	// flags[4] = revival tokens (0-2, decremented on use, resets on resupply)
	alive := flags[0] > 0
	hp := 0
	if alive {
		hp = 100 // default full HP; service layer overrides with event timeline HP
	}

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
		Supply:        int(flags[3]),
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
		pois = append(pois, POIObject{
			ID:       int(entry[0]),
			Type:     poiType,
			Team:     int(entry[12]),
			Resource: int(entry[13]),
		})
		// Store raw coords in the Lat/Lng fields temporarily — caller must convert
		pois[len(pois)-1].Lat = float64(rawLat)
		pois[len(pois)-1].Lng = float64(rawLng)
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
