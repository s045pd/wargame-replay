package decoder

import (
	"encoding/binary"
	"fmt"
)

const entrySize = 15

func DecodePositionEntry(data []byte) UnitPosition {
	if len(data) < entrySize {
		return UnitPosition{}
	}
	rawLat := binary.LittleEndian.Uint32(data[2:6])
	rawLng := binary.LittleEndian.Uint32(data[6:10])
	flags := make([]byte, 5)
	copy(flags, data[10:15])

	return UnitPosition{
		ID:       data[0],
		UnitType: data[1],
		RawLat:   rawLat,
		RawLng:   rawLng,
		Flags:    flags,
		FlagsHex: fmt.Sprintf("%x", flags),
		Team:     decodeTeam(data[0], flags),
		Alive:    decodeAlive(flags),
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

// decodeTeam: byte 0 of flags — 0x64 (100) appears to be red, 0x00 blue
// Fallback: SrcIndex 21-49 = red, 50-76 = blue, 500+ = observer
func decodeTeam(unitID uint8, flags []byte) string {
	if len(flags) > 0 {
		if flags[0] == 0x64 {
			return "red"
		}
		if flags[0] == 0x00 || flags[0] == 0x32 {
			return "blue"
		}
	}
	// Fallback by ID range
	id := int(unitID)
	if id >= 21 && id <= 49 {
		return "red"
	}
	if id >= 50 && id <= 76 {
		return "blue"
	}
	if id >= 500 {
		return "observer"
	}
	return "unknown"
}

// decodeAlive: bytes 2-3 of flags — 0xFE appears to be alive
func decodeAlive(flags []byte) bool {
	if len(flags) >= 4 {
		return flags[3] == 0xFE || flags[3] == 0xFF
	}
	return true // default alive
}
