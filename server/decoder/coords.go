package decoder

import (
	"database/sql"
	"math"
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

// AutoDetectCoords tries common Chinese coordinate transforms
func AutoDetectCoords(db *sql.DB) (CoordResolver, CoordMode, error) {
	var minLat, maxLat, minLng, maxLng uint32
	err := scanCoordBounds(db, &minLat, &maxLat, &minLng, &maxLng)
	if err != nil {
		return nil, CoordRelative, err
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
		ORDER BY LogTime LIMIT 100
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	*minLat = math.MaxUint32
	*minLng = math.MaxUint32
	*maxLat = 0
	*maxLng = 0

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
	return nil
}
