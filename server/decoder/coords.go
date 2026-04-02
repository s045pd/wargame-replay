package decoder

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
)

type CoordResolver interface {
	Convert(rawLat, rawLng uint32) (float64, float64)
	Mode() CoordMode
}

// RelativeResolver normalizes to 0-1 range
type RelativeResolver struct {
	minLat, maxLat, minLng, maxLng float64
}

func NewRelativeResolver(minLat, maxLat, minLng, maxLng uint32) *RelativeResolver {
	return &RelativeResolver{
		minLat: float64(minLat), maxLat: float64(maxLat),
		minLng: float64(minLng), maxLng: float64(maxLng),
	}
}

func (r *RelativeResolver) Convert(rawLat, rawLng uint32) (float64, float64) {
	lat := (float64(rawLat) - r.minLat) / (r.maxLat - r.minLat)
	lng := (float64(rawLng) - r.minLng) / (r.maxLng - r.minLng)
	return math.Max(0, math.Min(1, lat)), math.Max(0, math.Min(1, lng))
}

func (r *RelativeResolver) Mode() CoordMode { return CoordRelative }

// WGS84Resolver applies a linear transform to WGS84
type WGS84Resolver struct {
	LatScale  float64
	LatOffset float64
	LngScale  float64
	LngOffset float64
}

func (r *WGS84Resolver) Convert(rawLat, rawLng uint32) (float64, float64) {
	lat := float64(rawLat)*r.LatScale + r.LatOffset
	lng := float64(rawLng)*r.LngScale + r.LngOffset
	return lat, lng
}

func (r *WGS84Resolver) Mode() CoordMode { return CoordWGS84 }

// MapMeta is the metadata from the .txt sidecar file next to the .db
type MapMeta struct {
	OK            bool    `json:"OK"`
	CenterOK      bool    `json:"CenterOK"`
	CenterLat     float64 `json:"CenterLat"`
	CenterLng     float64 `json:"CenterLng"`
	MaxNativeZoom int     `json:"MaxNativeZoom"`
	GratCR        int     `json:"GratCR"`
	GratLatBegin  float64 `json:"GratLatBegin"`
	GratLatSpace  float64 `json:"GratLatSpace"`
	GratLngBegin  float64 `json:"GratLngBegin"`
	GratLngSpace  float64 `json:"GratLngSpace"`
}

// LoadMapMeta reads the .txt sidecar file for a .db file.
func LoadMapMeta(dbPath string) (*MapMeta, error) {
	txtPath := strings.TrimSuffix(dbPath, ".db") + ".txt"
	data, err := os.ReadFile(txtPath)
	if err != nil {
		return nil, err
	}
	var meta MapMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	if !meta.OK || !meta.CenterOK {
		return nil, nil
	}
	return &meta, nil
}

// AutoDetectCoords determines the coordinate resolver.
// If a .txt sidecar file exists, it uses the center coordinates to compute
// the offset between raw database values and WGS84.
func AutoDetectCoords(db *sql.DB, dbPath string) (CoordResolver, CoordMode, error) {
	var minLat, maxLat, minLng, maxLng uint32
	err := scanCoordBounds(db, &minLat, &maxLat, &minLng, &maxLng)
	if err != nil {
		return nil, CoordRelative, err
	}

	// If a .txt metadata file exists and has valid data, use the known encoding:
	// raw = (WGS84 + 180) × 1e6  →  WGS84 = raw × 1e-6 - 180
	if meta, err := LoadMapMeta(dbPath); err == nil && meta != nil {
		return &WGS84Resolver{
			LatScale: 1e-6, LatOffset: -180,
			LngScale: 1e-6, LngOffset: -180,
		}, CoordWGS84, nil
	}

	// Fallback: heuristic auto-detection

	// Try: raw * 1e-6 - 180 (common encoding: (WGS84 + 180) × 1e6)
	testLat6 := float64(minLat)*1e-6 - 180
	testLng6 := float64(minLng)*1e-6 - 180
	if testLat6 > -90 && testLat6 < 90 && testLng6 > -180 && testLng6 < 180 {
		return &WGS84Resolver{LatScale: 1e-6, LatOffset: -180, LngScale: 1e-6, LngOffset: -180}, CoordWGS84, nil
	}

	// Try: raw / 1e7 directly
	testLat := float64(minLat) / 1e7
	testLng := float64(minLng) / 1e7
	if testLat > -90 && testLat < 90 && testLng > -180 && testLng < 180 {
		return &WGS84Resolver{LatScale: 1e-7, LatOffset: 0, LngScale: 1e-7, LngOffset: 0}, CoordWGS84, nil
	}

	// Try: lat/1e7, lng/1e7 + 80
	testLng80 := float64(minLng)/1e7 + 80
	if testLat > 18 && testLat < 55 && testLng80 > 73 && testLng80 < 136 {
		return &WGS84Resolver{LatScale: 1e-7, LatOffset: 0, LngScale: 1e-7, LngOffset: 80}, CoordWGS84, nil
	}

	// Try: lat/1e7, lng/1e7 + 90
	testLng90 := float64(minLng)/1e7 + 90
	if testLat > 18 && testLat < 55 && testLng90 > 73 && testLng90 < 136 {
		return &WGS84Resolver{LatScale: 1e-7, LatOffset: 0, LngScale: 1e-7, LngOffset: 90}, CoordWGS84, nil
	}

	// Fallback to relative
	return NewRelativeResolver(minLat, maxLat, minLng, maxLng), CoordRelative, nil
}

func scanCoordBounds(db *sql.DB, minLat, maxLat, minLng, maxLng *uint32) error {
	rows, err := db.Query(`
		SELECT LogData FROM record
		WHERE SrcType=1 AND DataType=1 AND LogData IS NOT NULL
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	*minLat = math.MaxUint32
	*minLng = math.MaxUint32
	*maxLat = 0
	*maxLng = 0

	found := false
	for rows.Next() {
		var blob []byte
		if err := rows.Scan(&blob); err != nil {
			continue
		}
		units := DecodePositionFrame(blob)
		for _, u := range units {
			if u.RawLat == 0 && u.RawLng == 0 {
				continue
			}
			found = true
			if u.RawLat < *minLat {
				*minLat = u.RawLat
			}
			if u.RawLat > *maxLat {
				*maxLat = u.RawLat
			}
			if u.RawLng < *minLng {
				*minLng = u.RawLng
			}
			if u.RawLng > *maxLng {
				*maxLng = u.RawLng
			}
		}
	}
	if !found {
		return fmt.Errorf("no position data found in database")
	}
	return nil
}
