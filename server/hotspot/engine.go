package hotspot

import (
	"database/sql"
	"math"
	"sort"
	"wargame-replay/server/decoder"
	"wargame-replay/server/index"
)

// HotRegion is a single high-activity region for a frame.
type HotRegion struct {
	CenterLat float64 `json:"centerLat"`
	CenterLng float64 `json:"centerLng"`
	Score     float32 `json:"score"`
	Radius    float32 `json:"radius"`
}

// HotspotFrame holds the hotspot data computed for one sampled timestamp.
type HotspotFrame struct {
	Ts         string      `json:"ts"`
	MaxScore   float32     `json:"maxScore"`
	TopRegions []HotRegion `json:"topRegions"`
}

// Scoring weights.
const (
	gridRows  = 20
	gridCols  = 20
	wDensity  = 0.25
	wVelocity = 0.15
	wEvents   = 0.40
	wStats    = 0.20
)

// ComputeHotspots analyses the replay DB and returns a sampled hotspot timeline.
// It samples ~500 frames for performance, computes per-cell weighted scores, and
// returns the top-3 regions per frame.
func ComputeHotspots(db *sql.DB, idx *index.TimeIndex, resolver decoder.CoordResolver, events []decoder.GameEvent) ([]HotspotFrame, error) {
	if idx.Len() == 0 {
		return nil, nil
	}

	// Build event count index keyed by timestamp.
	eventIndex := make(map[string]int, len(events))
	for _, e := range events {
		eventIndex[e.Ts]++
	}

	// Determine coordinate bounds by sampling the first 50 frames.
	minLat, minLng := math.MaxFloat64, math.MaxFloat64
	maxLat, maxLng := -math.MaxFloat64, -math.MaxFloat64

	sampleCount := min(50, idx.Len())
	for i := 0; i < sampleCount; i++ {
		ts, _ := idx.TimestampAt(i)
		for _, u := range queryFrame(db, ts) {
			lat, lng := resolver.Convert(u.RawLat, u.RawLng)
			if u.RawLat == 0 && u.RawLng == 0 {
				continue
			}
			if lat < minLat {
				minLat = lat
			}
			if lat > maxLat {
				maxLat = lat
			}
			if lng < minLng {
				minLng = lng
			}
			if lng > maxLng {
				maxLng = lng
			}
		}
	}

	// Guard against degenerate bounds.
	if maxLat == minLat {
		maxLat = minLat + 1
	}
	if maxLng == minLng {
		maxLng = minLng + 1
	}

	// Add 10% padding on each side.
	latPad := (maxLat - minLat) * 0.1
	lngPad := (maxLng - minLng) * 0.1
	minLat -= latPad
	maxLat += latPad
	minLng -= lngPad
	maxLng += lngPad

	grid := NewGrid(gridRows, gridCols, minLat, maxLat, minLng, maxLng)

	// Sample ~500 frames evenly across the timeline.
	step := max(1, idx.Len()/500)
	var frames []HotspotFrame
	var prevPositions map[uint16][2]float64

	for i := 0; i < idx.Len(); i += step {
		ts, _ := idx.TimestampAt(i)
		grid.Reset()

		units := queryFrame(db, ts)
		curPositions := make(map[uint16][2]float64, len(units))

		for _, u := range units {
			if u.RawLat == 0 && u.RawLng == 0 {
				continue
			}
			lat, lng := resolver.Convert(u.RawLat, u.RawLng)
			grid.AddUnit(lat, lng)
			curPositions[u.ID] = [2]float64{lat, lng}

			// Accumulate velocity from position delta.
			if prev, ok := prevPositions[u.ID]; ok {
				dx := lat - prev[0]
				dy := lng - prev[1]
				v := math.Sqrt(dx*dx + dy*dy)
				r, c := grid.CellFor(lat, lng)
				if r >= 0 && r < gridRows && c >= 0 && c < gridCols {
					grid.Cells[r][c].Velocity += v
				}
			}
		}

		// Count events near this timestamp.
		evCount := eventIndex[ts]

		// Find per-signal maximums for normalisation.
		maxDensity := 0.0
		maxVelocity := 0.0
		for r := range grid.Cells {
			for c := range grid.Cells[r] {
				d := float64(grid.Cells[r][c].Units)
				v := grid.Cells[r][c].Velocity
				if d > maxDensity {
					maxDensity = d
				}
				if v > maxVelocity {
					maxVelocity = v
				}
			}
		}

		// Score every occupied cell.
		type scored struct {
			r, c  int
			score float64
		}
		var all []scored

		for r := range grid.Cells {
			for c := range grid.Cells[r] {
				cell := grid.Cells[r][c]
				if cell.Units == 0 {
					continue
				}
				normD := float64(cell.Units) / math.Max(1, maxDensity)
				normV := cell.Velocity / math.Max(0.001, maxVelocity)
				normE := math.Min(1, float64(evCount)/10.0)
				normS := normD * 0.5 // simplified stats delta signal

				score := wDensity*normD + wVelocity*normV + wEvents*normE + wStats*normS
				all = append(all, scored{r, c, score})
			}
		}

		sort.Slice(all, func(i, j int) bool { return all[i].score > all[j].score })

		frame := HotspotFrame{Ts: ts}
		topN := min(3, len(all))
		for k := 0; k < topN; k++ {
			s := all[k]
			lat, lng := grid.CellCenter(s.r, s.c)
			frame.TopRegions = append(frame.TopRegions, HotRegion{
				CenterLat: lat,
				CenterLng: lng,
				Score:     float32(s.score),
				Radius:    float32(grid.CellSize),
			})
			if k == 0 {
				frame.MaxScore = float32(s.score)
			}
		}

		frames = append(frames, frame)
		prevPositions = curPositions
	}

	return frames, nil
}

// queryFrame fetches the raw position blob for a timestamp and decodes it.
func queryFrame(db *sql.DB, ts string) []decoder.UnitPosition {
	var blob []byte
	err := db.QueryRow(
		"SELECT LogData FROM record WHERE LogTime = ? AND SrcType=1 AND DataType=1 LIMIT 1",
		ts,
	).Scan(&blob)
	if err != nil {
		return nil
	}
	return decoder.DecodePositionFrame(blob)
}
