# WarGame Replay 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a professional war game replay webapp with immersive 3D map replay, director mode with hotspot-based camera switching, bookmarks, and clip editing.

**Architecture:** Go (Gin) backend reads SQLite `.db` files containing binary-encoded position/event data, builds time indexes and precomputes hotspot scores, serves decoded frames via REST+WebSocket. React frontend with Mapbox GL renders units on a 3D dark-themed map with dual-mode UI (replay + director) and multi-track timeline.

**Tech Stack:** Go 1.22+, Gin, go-sqlite3, gorilla/websocket | React 18, TypeScript, Vite, shadcn/ui, TailwindCSS, Mapbox GL JS, Zustand

**Spec:** `docs/superpowers/specs/2026-03-30-wargame-replay-design.md`

**Test DB:** `9_2026-01-17-11-40-00_2026-01-17-20-00-11.db` (root of repo)

---

## Phase 1: Go Backend Core

### Task 1: Project Scaffolding

**Files:**
- Create: `wargame-replay/server/go.mod`
- Create: `wargame-replay/server/main.go`
- Create: `wargame-replay/web/package.json`
- Create: `wargame-replay/web/vite.config.ts`
- Create: `wargame-replay/web/tsconfig.json`
- Create: `wargame-replay/web/tailwind.config.ts`
- Create: `wargame-replay/web/src/main.tsx`
- Create: `wargame-replay/web/index.html`

- [ ] **Step 1: Initialize Go module**

```bash
mkdir -p wargame-replay/server
cd wargame-replay/server
go mod init wargame-replay/server
go get github.com/gin-gonic/gin
go get github.com/mattn/go-sqlite3
go get github.com/gorilla/websocket
```

- [ ] **Step 2: Create minimal main.go**

```go
// wargame-replay/server/main.go
package main

import (
	"flag"
	"fmt"
	"log"
	"github.com/gin-gonic/gin"
)

func main() {
	dir := flag.String("dir", ".", "Directory containing .db files")
	host := flag.String("host", "127.0.0.1", "Listen host")
	port := flag.Int("port", 8080, "Listen port")
	flag.Parse()

	r := gin.Default()
	r.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "dir": *dir})
	})

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("Starting server on %s, scanning %s", addr, *dir)
	log.Fatal(r.Run(addr))
}
```

- [ ] **Step 3: Verify Go server starts**

Run: `cd wargame-replay/server && go run main.go --dir ../../`
Expected: Server starts, `curl http://localhost:8080/api/health` returns `{"dir":"../../","status":"ok"}`

- [ ] **Step 4: Initialize React app with Vite**

```bash
cd wargame-replay
npm create vite@latest web -- --template react-ts
cd web
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install zustand mapbox-gl @types/mapbox-gl
```

- [ ] **Step 5: Configure TailwindCSS**

In `wargame-replay/web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'http://localhost:8080', ws: true }
    }
  }
})
```

Replace `web/src/index.css` with:
```css
@import "tailwindcss";
```

- [ ] **Step 6: Verify React dev server starts**

Run: `cd wargame-replay/web && npm run dev`
Expected: Vite dev server starts on localhost:5173

- [ ] **Step 7: Commit**

```bash
git add wargame-replay/
git commit -m "feat: scaffold Go backend and React frontend"
```

---

### Task 2: DB Scanner

**Files:**
- Create: `wargame-replay/server/scanner/scanner.go`
- Create: `wargame-replay/server/scanner/scanner_test.go`

- [ ] **Step 1: Write scanner test**

```go
// scanner/scanner_test.go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wargame-replay/server && go test ./scanner/ -v`
Expected: FAIL — package not found

- [ ] **Step 3: Implement scanner**

```go
// scanner/scanner.go
package scanner

import (
	"crypto/sha256"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

type GameInfo struct {
	ID          string `json:"id"`
	Session     string `json:"session"`
	StartTime   string `json:"startTime"`
	EndTime     string `json:"endTime"`
	PlayerCount int    `json:"playerCount"`
	Filename    string `json:"filename"`
	FilePath    string `json:"-"`
	DisplayName string `json:"displayName"`
}

var filenameRe = regexp.MustCompile(`^(\w+)_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.db$`)

func ParseFilename(filename string) (*GameInfo, error) {
	m := filenameRe.FindStringSubmatch(filename)
	if m == nil {
		return nil, fmt.Errorf("filename %q does not match expected pattern", filename)
	}
	name := strings.TrimSuffix(filename, ".db")
	hash := sha256.Sum256([]byte(name))
	id := fmt.Sprintf("%x", hash[:4])

	startTime := strings.Replace(m[2], "-", " ", 1)
	startTime = strings.Replace(startTime, "-", ":", 2) // only last 2 dashes
	endTime := strings.Replace(m[3], "-", " ", 1)
	endTime = strings.Replace(endTime, "-", ":", 2)

	// More precise: replace pattern YYYY-MM-DD-HH-MM-SS → YYYY-MM-DD HH:MM:SS
	startTime = formatTimestamp(m[2])
	endTime = formatTimestamp(m[3])

	return &GameInfo{
		ID:          id,
		Session:     m[1],
		StartTime:   startTime,
		EndTime:     endTime,
		Filename:    filename,
		DisplayName: fmt.Sprintf("Session %s · %s ~ %s", m[1], startTime[:16], endTime[11:16]),
	}, nil
}

func formatTimestamp(s string) string {
	// "2026-01-17-11-40-00" → "2026-01-17 11:40:00"
	parts := strings.SplitN(s, "-", 4) // ["2026", "01", "17", "11-40-00"]
	if len(parts) < 4 {
		return s
	}
	timePart := strings.Replace(parts[3], "-", ":", -1)
	return fmt.Sprintf("%s-%s-%s %s", parts[0], parts[1], parts[2], timePart)
}

func ScanDirectory(dir string) ([]GameInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var games []GameInfo
	seen := map[string]int{} // id collision tracking
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		info, err := ParseFilename(e.Name())
		if err != nil {
			continue
		}
		if n, exists := seen[info.ID]; exists {
			info.ID = fmt.Sprintf("%s-%d", info.ID, n+1)
			seen[info.ID] = n + 1
		} else {
			seen[info.ID] = 0
		}
		info.FilePath = filepath.Join(dir, e.Name())

		// Read player count from tag table
		playerCount, _ := readPlayerCount(info.FilePath)
		info.PlayerCount = playerCount

		games = append(games, *info)
	}
	return games, nil
}

func readPlayerCount(dbPath string) (int, error) {
	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return 0, err
	}
	defer db.Close()
	var count int
	err = db.QueryRow("SELECT COUNT(DISTINCT SrcIndex) FROM tag WHERE SrcType=1 AND TagText <> ''").Scan(&count)
	return count, err
}
```

- [ ] **Step 4: Run tests**

Run: `cd wargame-replay/server && go test ./scanner/ -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wargame-replay/server/scanner/
git commit -m "feat: add DB directory scanner with filename parsing"
```

---

### Task 3: Protocol Decoder — Position Data (DataType=1)

**Files:**
- Create: `wargame-replay/server/decoder/types.go`
- Create: `wargame-replay/server/decoder/position.go`
- Create: `wargame-replay/server/decoder/position_test.go`

- [ ] **Step 1: Define shared types**

```go
// decoder/types.go
package decoder

type UnitPosition struct {
	ID       uint8   `json:"id"`
	UnitType uint8   `json:"type"`  // 0=player, 1=special, 2=base
	RawLat   uint32  `json:"-"`
	RawLng   uint32  `json:"-"`
	Lat      float64 `json:"lat,omitempty"`
	Lng      float64 `json:"lng,omitempty"`
	X        float64 `json:"x,omitempty"`
	Y        float64 `json:"y,omitempty"`
	Team     string  `json:"team"`
	Alive    bool    `json:"alive"`
	Flags    []byte  `json:"-"`
	FlagsHex string  `json:"flags"`
}

type GameEvent struct {
	Type   string `json:"type"` // "kill", "hit", "status"
	SrcID  int    `json:"src"`
	DstID  int    `json:"dst,omitempty"`
	Ts     string `json:"ts"`
	Detail string `json:"detail,omitempty"`
}

type CoordMode string

const (
	CoordWGS84    CoordMode = "wgs84"
	CoordRelative CoordMode = "relative"
)
```

- [ ] **Step 2: Write position decoder test**

```go
// decoder/position_test.go
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
		"4400 6A5B8F0C9E018D116482FEFE01" +
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd wargame-replay/server && go test ./decoder/ -v -run TestDecode`
Expected: FAIL

- [ ] **Step 4: Implement position decoder**

```go
// decoder/position.go
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
```

- [ ] **Step 5: Run tests**

Run: `cd wargame-replay/server && go test ./decoder/ -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add wargame-replay/server/decoder/
git commit -m "feat: add DataType=1 position frame decoder"
```

---

### Task 3b: Event Decoder (DataType=5 Kill/Hit)

**Files:**
- Create: `wargame-replay/server/decoder/event.go`
- Create: `wargame-replay/server/decoder/event_test.go`

This is **P0 priority** — the hotspot engine's Events signal (weight 0.40) depends on this.

- [ ] **Step 1: Write event decoder test**

```go
// decoder/event_test.go
package decoder

import (
	"database/sql"
	"testing"
	_ "github.com/mattn/go-sqlite3"
)

func TestDecodeKillEvents(t *testing.T) {
	db, err := sql.Open("sqlite3", "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db?mode=ro")
	if err != nil {
		t.Skip("test db not found")
	}
	defer db.Close()

	events, err := LoadAllEvents(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) == 0 {
		t.Error("expected some events")
	}
	t.Logf("Loaded %d events", len(events))
	for i, e := range events {
		if i < 5 {
			t.Logf("  %s: %s src=%d dst=%d", e.Ts, e.Type, e.SrcID, e.DstID)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wargame-replay/server && go test ./decoder/ -v -run TestDecodeKill`
Expected: FAIL

- [ ] **Step 3: Implement event decoder**

```go
// decoder/event.go
package decoder

import (
	"database/sql"
	"encoding/binary"
)

// LoadAllEvents reads DataType=5 (kill/hit) records and attempts to decode them.
// DataType=5 blobs are 224 bytes each. We attempt to extract killer/victim IDs
// by analyzing the structure. This is reverse-engineered and may need refinement.
func LoadAllEvents(db *sql.DB) ([]GameEvent, error) {
	rows, err := db.Query(`
		SELECT LogTime, LogData FROM record
		WHERE SrcType=64 AND DataType=5 AND LogData IS NOT NULL
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []GameEvent
	for rows.Next() {
		var ts string
		var blob []byte
		if err := rows.Scan(&ts, &blob); err != nil {
			continue
		}
		if len(blob) < 16 {
			continue
		}
		// Attempt to extract kill event data from the 224-byte blob
		// Try reading pairs of uint32 as cumulative team stats
		// First 8 bytes appear to be team score summaries
		ev := decodeKillBlob(ts, blob)
		events = append(events, ev...)
	}
	return events, nil
}

func decodeKillBlob(ts string, blob []byte) []GameEvent {
	// DataType=5 is 224 bytes. Observed structure:
	// Bytes 0-3: uint32 LE — value A (cumulative)
	// Bytes 4-7: uint32 LE — value B (cumulative)
	// Bytes 8-11: uint32 LE — value C
	// ...
	// Strategy: compare consecutive records to detect increments (= new kills)
	// For now, emit one event per record with raw data for later refinement
	if len(blob) < 8 {
		return nil
	}
	teamAScore := binary.LittleEndian.Uint32(blob[0:4])
	teamBScore := binary.LittleEndian.Uint32(blob[4:8])

	var events []GameEvent
	if teamAScore > 0 || teamBScore > 0 {
		events = append(events, GameEvent{
			Type:   "score_update",
			Ts:     ts,
			SrcID:  int(teamAScore),
			DstID:  int(teamBScore),
			Detail: "cumulative team scores",
		})
	}
	return events
}

// LoadStatusEvents reads DataType=2 (status change) records
func LoadStatusEvents(db *sql.DB) ([]GameEvent, error) {
	rows, err := db.Query(`
		SELECT SrcIndex, LogTime, LocLat, LocLng, LogData FROM record
		WHERE DataType=2 AND LogData IS NOT NULL
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []GameEvent
	for rows.Next() {
		var srcIdx int
		var ts string
		var lat, lng int64
		var blob []byte
		if err := rows.Scan(&srcIdx, &ts, &lat, &lng, &blob); err != nil {
			continue
		}
		events = append(events, GameEvent{
			Type:  "status",
			Ts:    ts,
			SrcID: srcIdx,
		})
	}
	return events, nil
}
```

- [ ] **Step 4: Run tests**

Run: `cd wargame-replay/server && go test ./decoder/ -v -run TestDecodeKill`
Expected: PASS, logs show loaded events

- [ ] **Step 5: Commit**

```bash
git add wargame-replay/server/decoder/event.go wargame-replay/server/decoder/event_test.go
git commit -m "feat: add DataType=5 kill/hit and DataType=2 status event decoders"
```

---

### Task 4: Coordinate Resolver

**Files:**
- Create: `wargame-replay/server/decoder/coords.go`
- Create: `wargame-replay/server/decoder/coords_test.go`

- [ ] **Step 1: Write coordinate resolver test**

```go
// decoder/coords_test.go
package decoder

import (
	"testing"
	"database/sql"
	_ "github.com/mattn/go-sqlite3"
)

func TestRelativeCoords(t *testing.T) {
	resolver := NewRelativeResolver(200000000, 220000000, 280000000, 300000000)
	lat, lng := resolver.Convert(210000000, 290000000)
	if lat < 0 || lat > 1 || lng < 0 || lng > 1 {
		t.Errorf("relative coords out of range: %f, %f", lat, lng)
	}
}

func TestResolverFromDB(t *testing.T) {
	db, err := sql.Open("sqlite3", "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db?mode=ro")
	if err != nil {
		t.Skip("test db not found")
	}
	defer db.Close()

	resolver, mode, err := AutoDetectCoords(db)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Detected coord mode: %s", mode)

	if resolver == nil {
		t.Fatal("resolver is nil")
	}
	// Test with a known raw coordinate
	lat, lng := resolver.Convert(210719404, 294449177)
	t.Logf("Converted: lat=%f, lng=%f", lat, lng)
	if mode == CoordRelative {
		if lat < 0 || lat > 1 {
			t.Errorf("relative lat out of range: %f", lat)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wargame-replay/server && go test ./decoder/ -v -run TestResolver`
Expected: FAIL

- [ ] **Step 3: Implement coordinate resolver**

```go
// decoder/coords.go
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
	// Get coordinate bounds from DataType=1 position data
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

	// Try: lat/1e7, lng/1e7 + 80 (observed in analysis)
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
	// Sample position data to find coordinate bounds
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
			if u.RawLat < *minLat { *minLat = u.RawLat }
			if u.RawLat > *maxLat { *maxLat = u.RawLat }
			if u.RawLng < *minLng { *minLng = u.RawLng }
			if u.RawLng > *maxLng { *maxLng = u.RawLng }
		}
	}
	return nil
}
```

- [ ] **Step 4: Run tests**

Run: `cd wargame-replay/server && go test ./decoder/ -v -run TestResolver`
Expected: PASS, logs show detected coord mode

- [ ] **Step 5: Commit**

```bash
git add wargame-replay/server/decoder/coords.go wargame-replay/server/decoder/coords_test.go
git commit -m "feat: add auto-detect coordinate resolver with WGS84 and relative fallback"
```

---

### Task 5: Time Index + LRU Cache

**Files:**
- Create: `wargame-replay/server/index/timeindex.go`
- Create: `wargame-replay/server/index/cache.go`
- Create: `wargame-replay/server/index/timeindex_test.go`

- [ ] **Step 1: Write time index test**

```go
// index/timeindex_test.go
package index

import (
	"database/sql"
	"testing"
	_ "github.com/mattn/go-sqlite3"
)

func TestBuildTimeIndex(t *testing.T) {
	db, err := sql.Open("sqlite3", "../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db?mode=ro")
	if err != nil {
		t.Skip("test db not found")
	}
	defer db.Close()

	idx, err := BuildTimeIndex(db)
	if err != nil {
		t.Fatal(err)
	}
	if idx.Len() == 0 {
		t.Fatal("empty index")
	}
	t.Logf("Index entries: %d, range: %s to %s", idx.Len(), idx.StartTime(), idx.EndTime())

	// Test lookup
	rowID, found := idx.Lookup("2026-01-17 12:00:00")
	if !found {
		t.Error("lookup failed for valid timestamp")
	}
	if rowID == 0 {
		t.Error("expected non-zero rowID")
	}
}

func TestLRUCache(t *testing.T) {
	c := NewLRUCache(1024) // 1KB limit for test
	c.Put("key1", []byte("hello"))
	val, ok := c.Get("key1")
	if !ok || string(val) != "hello" {
		t.Error("cache miss or wrong value")
	}
	// Fill to evict
	c.Put("key2", make([]byte, 1024))
	_, ok = c.Get("key1")
	if ok {
		t.Error("expected key1 to be evicted")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wargame-replay/server && go test ./index/ -v`
Expected: FAIL

- [ ] **Step 3: Implement time index**

```go
// index/timeindex.go
package index

import (
	"database/sql"
	"sort"
)

type TimeIndex struct {
	timestamps []string
	rowIDs     []int64
}

func BuildTimeIndex(db *sql.DB) (*TimeIndex, error) {
	rows, err := db.Query(`
		SELECT DISTINCT LogTime, MIN(ID)
		FROM record
		WHERE SrcType=1 AND DataType=1
		GROUP BY LogTime
		ORDER BY LogTime
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	idx := &TimeIndex{}
	for rows.Next() {
		var ts string
		var rowID int64
		if err := rows.Scan(&ts, &rowID); err != nil {
			continue
		}
		idx.timestamps = append(idx.timestamps, ts)
		idx.rowIDs = append(idx.rowIDs, rowID)
	}
	return idx, nil
}

func (idx *TimeIndex) Len() int {
	return len(idx.timestamps)
}

func (idx *TimeIndex) StartTime() string {
	if len(idx.timestamps) == 0 {
		return ""
	}
	return idx.timestamps[0]
}

func (idx *TimeIndex) EndTime() string {
	if len(idx.timestamps) == 0 {
		return ""
	}
	return idx.timestamps[len(idx.timestamps)-1]
}

func (idx *TimeIndex) Lookup(ts string) (int64, bool) {
	i := sort.SearchStrings(idx.timestamps, ts)
	if i >= len(idx.timestamps) {
		i = len(idx.timestamps) - 1
	}
	if i < 0 {
		return 0, false
	}
	return idx.rowIDs[i], true
}

// TimestampAt returns the timestamp at the given index offset
func (idx *TimeIndex) TimestampAt(offset int) (string, bool) {
	if offset < 0 || offset >= len(idx.timestamps) {
		return "", false
	}
	return idx.timestamps[offset], true
}

// IndexOf returns the index of the closest timestamp
func (idx *TimeIndex) IndexOf(ts string) int {
	i := sort.SearchStrings(idx.timestamps, ts)
	if i >= len(idx.timestamps) {
		return len(idx.timestamps) - 1
	}
	return i
}
```

- [ ] **Step 4: Implement LRU cache**

```go
// index/cache.go
package index

import (
	"container/list"
	"sync"
)

type LRUCache struct {
	maxBytes  int64
	usedBytes int64
	mu        sync.Mutex
	ll        *list.List
	cache     map[string]*list.Element
}

type cacheEntry struct {
	key   string
	value []byte
}

func NewLRUCache(maxBytes int64) *LRUCache {
	return &LRUCache{
		maxBytes: maxBytes,
		ll:       list.New(),
		cache:    make(map[string]*list.Element),
	}
}

func (c *LRUCache) Get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ele, ok := c.cache[key]; ok {
		c.ll.MoveToFront(ele)
		return ele.Value.(*cacheEntry).value, true
	}
	return nil, false
}

func (c *LRUCache) Put(key string, value []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if ele, ok := c.cache[key]; ok {
		c.ll.MoveToFront(ele)
		old := ele.Value.(*cacheEntry)
		c.usedBytes += int64(len(value)) - int64(len(old.value))
		old.value = value
	} else {
		ele := c.ll.PushFront(&cacheEntry{key, value})
		c.cache[key] = ele
		c.usedBytes += int64(len(value)) + int64(len(key))
	}
	for c.usedBytes > c.maxBytes && c.ll.Len() > 0 {
		c.removeOldest()
	}
}

func (c *LRUCache) removeOldest() {
	ele := c.ll.Back()
	if ele == nil {
		return
	}
	c.ll.Remove(ele)
	entry := ele.Value.(*cacheEntry)
	delete(c.cache, entry.key)
	c.usedBytes -= int64(len(entry.value)) + int64(len(entry.key))
}
```

- [ ] **Step 5: Run tests**

Run: `cd wargame-replay/server && go test ./index/ -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add wargame-replay/server/index/
git commit -m "feat: add time index and LRU cache"
```

---

### Task 6: Game Service — Load & Query

**Files:**
- Create: `wargame-replay/server/game/service.go`
- Create: `wargame-replay/server/game/service_test.go`

- [ ] **Step 1: Write game service test**

```go
// game/service_test.go
package game

import (
	"testing"
)

func TestLoadGame(t *testing.T) {
	svc, err := LoadGame("../../../9_2026-01-17-11-40-00_2026-01-17-20-00-11.db")
	if err != nil {
		t.Fatal(err)
	}
	defer svc.Close()

	meta := svc.Meta()
	if meta.CoordMode == "" {
		t.Error("expected coordMode")
	}
	if len(meta.Players) == 0 {
		t.Error("expected players")
	}
	t.Logf("CoordMode: %s, Players: %d, TimeRange: %s to %s",
		meta.CoordMode, len(meta.Players), meta.StartTime, meta.EndTime)

	// Test frame query
	frame, err := svc.GetFrame("2026-01-17 12:00:00")
	if err != nil {
		t.Fatal(err)
	}
	if len(frame.Units) == 0 {
		t.Error("expected units in frame")
	}
	t.Logf("Frame at 12:00: %d units", len(frame.Units))
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd wargame-replay/server && go test ./game/ -v`
Expected: FAIL

- [ ] **Step 3: Implement game service**

This ties together scanner, decoder, index, and cache into a single service. The implementation should:
- Open the db, build TimeIndex, auto-detect coords
- Load player names from tag table
- Provide `Meta()`, `GetFrame(ts)`, `GetFrameRange(from, to)` methods
- Use LRU cache for decoded frames

```go
// game/service.go
package game

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"wargame-replay/server/decoder"
	"wargame-replay/server/index"
	_ "github.com/mattn/go-sqlite3"
)

type PlayerInfo struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
	Team string `json:"team"`
}

type GameMeta struct {
	CoordMode string       `json:"coordMode"`
	StartTime string       `json:"startTime"`
	EndTime   string       `json:"endTime"`
	Players   []PlayerInfo `json:"players"`
}

type Frame struct {
	Type    string                  `json:"type"` // always "frame"
	Ts      string                  `json:"ts"`
	Units   []decoder.UnitPosition  `json:"units"`
	Events  []decoder.GameEvent     `json:"events"`
	Hotspot *HotspotInfo            `json:"hotspot,omitempty"`
}

type HotspotInfo struct {
	Score  float32   `json:"score"`
	Center [2]float64 `json:"center"` // [lat, lng]
	Radius float32   `json:"radius"`
}

type Service struct {
	db       *sql.DB
	idx      *index.TimeIndex
	cache    *index.LRUCache
	resolver decoder.CoordResolver
	players  map[int]string // id → name
	meta     GameMeta
}

const cacheMaxBytes = 100 * 1024 * 1024 // 100MB

func LoadGame(dbPath string) (*Service, error) {
	db, err := sql.Open("sqlite3", dbPath+"?mode=ro")
	if err != nil {
		return nil, err
	}

	// Build time index
	idx, err := index.BuildTimeIndex(db)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("build index: %w", err)
	}

	// Auto-detect coordinates
	resolver, coordMode, err := decoder.AutoDetectCoords(db)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("detect coords: %w", err)
	}

	// Load players
	players := loadPlayers(db)

	svc := &Service{
		db:       db,
		idx:      idx,
		cache:    index.NewLRUCache(cacheMaxBytes),
		resolver: resolver,
		players:  players,
		meta: GameMeta{
			CoordMode: string(coordMode),
			StartTime: idx.StartTime(),
			EndTime:   idx.EndTime(),
			Players:   buildPlayerList(players),
		},
	}
	return svc, nil
}

func (s *Service) Close() {
	s.db.Close()
}

func (s *Service) Meta() GameMeta {
	return s.meta
}

func (s *Service) GetFrame(ts string) (*Frame, error) {
	// Check cache
	if cached, ok := s.cache.Get(ts); ok {
		var f Frame
		json.Unmarshal(cached, &f)
		return &f, nil
	}

	rowID, found := s.idx.Lookup(ts)
	if !found {
		return nil, fmt.Errorf("timestamp %s not found", ts)
	}

	var blob []byte
	var actualTs string
	err := s.db.QueryRow(
		"SELECT LogTime, LogData FROM record WHERE ID >= ? AND SrcType=1 AND DataType=1 LIMIT 1",
		rowID,
	).Scan(&actualTs, &blob)
	if err != nil {
		return nil, err
	}

	units := decoder.DecodePositionFrame(blob)
	// Apply coordinate conversion + player names
	for i := range units {
		lat, lng := s.resolver.Convert(units[i].RawLat, units[i].RawLng)
		if s.resolver.Mode() == decoder.CoordWGS84 {
			units[i].Lat = lat
			units[i].Lng = lng
		} else {
			units[i].X = lat
			units[i].Y = lng
		}
		if name, ok := s.players[int(units[i].ID)]; ok {
			units[i].FlagsHex = units[i].FlagsHex // keep as is
		}
		_ = s.players // name attachment happens in JSON serialization
	}

	frame := &Frame{Type: "frame", Ts: actualTs, Units: units}

	// Cache it
	if data, err := json.Marshal(frame); err == nil {
		s.cache.Put(ts, data)
	}

	return frame, nil
}

func loadPlayers(db *sql.DB) map[int]string {
	players := make(map[int]string)
	rows, err := db.Query("SELECT SrcIndex, TagText FROM tag WHERE SrcType=1 AND TagText <> '' GROUP BY SrcIndex")
	if err != nil {
		return players
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var name string
		rows.Scan(&id, &name)
		players[id] = name
	}
	return players
}

func buildPlayerList(players map[int]string) []PlayerInfo {
	list := make([]PlayerInfo, 0, len(players))
	for id, name := range players {
		team := "unknown"
		if id >= 21 && id <= 49 {
			team = "red"
		} else if id >= 50 && id <= 76 {
			team = "blue"
		} else if id >= 500 {
			team = "observer"
		}
		list = append(list, PlayerInfo{ID: id, Name: name, Team: team})
	}
	return list
}
```

- [ ] **Step 4: Run tests**

Run: `cd wargame-replay/server && go test ./game/ -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add wargame-replay/server/game/
git commit -m "feat: add game service tying together decoder, index, and cache"
```

---

## Phase 2: REST API + WebSocket

### Task 7: REST API — Games List + Meta + Frame

**Files:**
- Create: `wargame-replay/server/api/games.go`
- Create: `wargame-replay/server/api/frames.go`
- Modify: `wargame-replay/server/main.go`

- [ ] **Step 1: Implement games API handler**

```go
// api/games.go
package api

import (
	"fmt"
	"net/http"
	"wargame-replay/server/game"
	"wargame-replay/server/scanner"
	"github.com/gin-gonic/gin"
)

type Handler struct {
	games    []scanner.GameInfo
	services map[string]*game.Service // gameID → service
	dataDir  string
}

func NewHandler(dataDir string) (*Handler, error) {
	games, err := scanner.ScanDirectory(dataDir)
	if err != nil {
		return nil, err
	}
	return &Handler{
		games:    games,
		services: make(map[string]*game.Service),
		dataDir:  dataDir,
	}, nil
}

func (h *Handler) ListGames(c *gin.Context) {
	c.JSON(http.StatusOK, h.games)
}

func (h *Handler) GetMeta(c *gin.Context) {
	svc, err := h.getService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, svc.Meta())
}

func (h *Handler) getService(gameID string) (*game.Service, error) {
	if svc, ok := h.services[gameID]; ok {
		return svc, nil
	}
	for _, g := range h.games {
		if g.ID == gameID {
			svc, err := game.LoadGame(g.FilePath)
			if err != nil {
				return nil, err
			}
			h.services[gameID] = svc
			return svc, nil
		}
	}
	return nil, fmt.Errorf("game %s not found", gameID)
}
```

Add missing import and implement frames handler in `api/frames.go`.

- [ ] **Step 2: Implement frames handler**

```go
// api/frames.go
package api

import (
	"net/http"
	"github.com/gin-gonic/gin"
)

func (h *Handler) GetFrame(c *gin.Context) {
	svc, err := h.getService(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	ts := c.Param("ts")
	frame, err := svc.GetFrame(ts)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, frame)
}
```

- [ ] **Step 3: Wire routes in main.go**

Update `main.go` to create the Handler and register routes:
```go
handler, err := api.NewHandler(*dir)
// ...
r.GET("/api/games", handler.ListGames)
r.GET("/api/games/:id/meta", handler.GetMeta)
r.GET("/api/games/:id/frame/:ts", handler.GetFrame)
```

- [ ] **Step 4: Manual test**

Run: `cd wargame-replay/server && go run main.go --dir ../../../`

Test:
```bash
curl http://localhost:8080/api/games | jq .
curl http://localhost:8080/api/games/<id>/meta | jq .
curl "http://localhost:8080/api/games/<id>/frame/2026-01-17 12:00:00" | jq .
```

Expected: JSON responses with game list, meta info, and frame data.

- [ ] **Step 5: Commit**

```bash
git add wargame-replay/server/api/ wargame-replay/server/main.go
git commit -m "feat: add REST API for games list, meta, and frame query"
```

---

### Task 8: WebSocket Stream

**Files:**
- Create: `wargame-replay/server/ws/stream.go`
- Modify: `wargame-replay/server/main.go`

- [ ] **Step 1: Implement WebSocket stream handler**

```go
// ws/stream.go
package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
	"wargame-replay/server/game"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Command struct {
	Cmd   string `json:"cmd"`
	To    string `json:"to,omitempty"`
	Speed int    `json:"speed,omitempty"`
	From  string `json:"from,omitempty"`
}

type StateMsg struct {
	Type      string `json:"type"`
	Ts        string `json:"ts"`
	Status    string `json:"status"` // "playing" or "paused"
	Speed     int    `json:"speed"`
	CoordMode string `json:"coordMode"`
}

type streamState struct {
	mu       sync.Mutex
	playing  bool
	speed    int
	currentI int // index into time index
	svc      *game.Service
}

func HandleStream(getService func(string) (*game.Service, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		gameID := c.Param("id")
		svc, err := getService(gameID)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}

		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Printf("ws upgrade error: %v", err)
			return
		}
		defer conn.Close()

		state := &streamState{
			speed:    1,
			currentI: 0,
			svc:      svc,
		}

		meta := svc.Meta()

		// Send initial state
		initMsg := StateMsg{
			Type:      "state",
			Ts:        meta.StartTime,
			Status:    "paused",
			Speed:     1,
			CoordMode: meta.CoordMode,
		}
		conn.WriteJSON(initMsg)

		// Command reader goroutine
		cmdCh := make(chan Command, 10)
		go func() {
			for {
				var cmd Command
				if err := conn.ReadJSON(&cmd); err != nil {
					close(cmdCh)
					return
				}
				cmdCh <- cmd
			}
		}()

		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()

		for {
			select {
			case cmd, ok := <-cmdCh:
				if !ok {
					return // connection closed
				}
				state.handleCommand(cmd, svc, conn)

			case <-ticker.C:
				state.mu.Lock()
				if state.playing {
					state.sendFrame(conn, svc)
					state.currentI += state.speed
				}
				state.mu.Unlock()
			}
		}
	}
}

func (s *streamState) handleCommand(cmd Command, svc *game.Service, conn *websocket.Conn) {
	s.mu.Lock()
	defer s.mu.Unlock()

	idx := svc.TimeIndex()
	switch cmd.Cmd {
	case "play":
		s.playing = true
		if cmd.Speed > 0 {
			s.speed = cmd.Speed
		}
	case "pause":
		s.playing = false
	case "seek":
		// Normalize ISO 8601 (2026-01-17T13:20:00) to internal format (2026-01-17 13:20:00)
		ts := strings.Replace(cmd.To, "T", " ", 1)
		s.currentI = idx.IndexOf(ts)
		if !s.playing {
			s.sendFrame(conn, svc)
		}
	}
}

func (s *streamState) sendFrame(conn *websocket.Conn, svc *game.Service) {
	idx := svc.TimeIndex()
	ts, ok := idx.TimestampAt(s.currentI)
	if !ok {
		s.playing = false
		return
	}
	frame, err := svc.GetFrame(ts)
	if err != nil {
		return
	}
	data, _ := json.Marshal(frame)
	conn.WriteMessage(websocket.TextMessage, data)
}
```

- [ ] **Step 2: Expose TimeIndex from game.Service**

Add to `game/service.go`:
```go
func (s *Service) TimeIndex() *index.TimeIndex {
	return s.idx
}
```

- [ ] **Step 3: Wire WebSocket route in main.go**

```go
r.GET("/ws/games/:id/stream", ws.HandleStream(handler.GetService))
```

Expose `GetService` as public method on Handler.

- [ ] **Step 4: Manual test with wscat**

Run server, then:
```bash
npx wscat -c ws://localhost:8080/ws/games/<id>/stream
```
Expected: Receives `{"type":"state",...}` on connect. Send `{"cmd":"play","speed":1}` to start receiving frames.

- [ ] **Step 5: Commit**

```bash
git add wargame-replay/server/ws/ wargame-replay/server/main.go wargame-replay/server/game/service.go
git commit -m "feat: add WebSocket stream handler with play/pause/seek"
```

---

## Phase 3: Frontend — Basic Replay

### Task 9: Frontend Shell + shadcn/ui Setup

**Files:**
- Modify: `wargame-replay/web/src/App.tsx`
- Create: `wargame-replay/web/src/components/TopBar.tsx`
- Create: `wargame-replay/web/src/store/playback.ts`
- Create: `wargame-replay/web/src/lib/api.ts`
- Create: `wargame-replay/web/src/lib/ws.ts`

- [ ] **Step 1: Install shadcn/ui dependencies**

```bash
cd wargame-replay/web
npx shadcn@latest init
# Choose: dark theme, zinc base color, CSS variables
npx shadcn@latest add button tabs select slider
```

- [ ] **Step 2: Create API client + WebSocket client**

`lib/api.ts` — REST fetchers for games list, meta, frame.
`lib/ws.ts` — WebSocket connection manager with reconnect, command sending, message parsing.

- [ ] **Step 3: Create Zustand playback store**

`store/playback.ts` — state: currentTs, playing, speed, units[], events[], coordMode, gameId, connected.

- [ ] **Step 4: Create TopBar component**

`components/TopBar.tsx` — Logo, mode toggle (Replay/Director), game info display, map style switcher.

- [ ] **Step 5: Create App shell with layout**

`App.tsx` — Game selection screen (if no game loaded) or main replay layout with TopBar + map area + timeline slot.

- [ ] **Step 6: Verify dev server renders shell**

Run: `npm run dev`
Expected: Dark themed shell with TopBar renders at localhost:5173.

- [ ] **Step 7: Commit**

```bash
git add wargame-replay/web/
git commit -m "feat: frontend shell with shadcn/ui, API client, WebSocket client, Zustand store"
```

---

### Task 10: Map View + Unit Layer

**Files:**
- Create: `wargame-replay/web/src/map/MapView.tsx`
- Create: `wargame-replay/web/src/map/UnitLayer.tsx`
- Create: `wargame-replay/web/src/map/RelativeCanvas.tsx`
- Create: `wargame-replay/web/src/map/styles.ts`

- [ ] **Step 1: Create map style definitions**

`map/styles.ts` — Mapbox style URLs for dark/satellite/terrain modes. Define unit circle paint properties (red/blue glow).

- [ ] **Step 2: Create MapView component**

`map/MapView.tsx` — Initialize Mapbox GL with dark style, 3D terrain, fit to game bounds. Accept units as prop, manage map lifecycle.

- [ ] **Step 3: Create UnitLayer component**

`map/UnitLayer.tsx` — GeoJSON source from units array, circle layer with team color (red=#00ff88, blue=#00aaff), pulse animation for selected unit, hover tooltip with name/stats.

- [ ] **Step 4: Create RelativeCanvas fallback renderer**

`map/RelativeCanvas.tsx` — When `coordMode === "relative"`, render a full-screen Canvas 2D overlay instead of Mapbox geo layers. Draw units using `x`/`y` fields (0-1 range) mapped to canvas dimensions. Same color scheme (red/blue glow) as UnitLayer. This activates automatically based on `coordMode` from the playback store.

- [ ] **Step 5: Connect to backend data**

Wire MapView into App: on game select → fetch meta → check `coordMode` → connect WebSocket → render units via Mapbox (wgs84) or RelativeCanvas (relative).

- [ ] **Step 5: Manual end-to-end test**

Start Go server + Vite dev. Select game, units appear on map. Send play command, units move.

- [ ] **Step 6: Commit**

```bash
git add wargame-replay/web/src/map/
git commit -m "feat: Mapbox GL map view with unit rendering"
```

---

### Task 11: Timeline Component

**Files:**
- Create: `wargame-replay/web/src/timeline/Timeline.tsx`
- Create: `wargame-replay/web/src/timeline/Track.tsx`
- Create: `wargame-replay/web/src/timeline/Playhead.tsx`
- Create: `wargame-replay/web/src/timeline/TransportControls.tsx`

- [ ] **Step 1: Create TransportControls**

Play/pause button, speed selector (1x/2x/4x/8x/16x), skip forward/back, current time display.

- [ ] **Step 2: Create Track component**

Single horizontal track with Canvas rendering. Accept data points and render colored regions/markers.

- [ ] **Step 3: Create Playhead component**

Vertical line at current time position, draggable for seek.

- [ ] **Step 4: Create Timeline container**

Assembles TransportControls + 4 tracks (hotspot/camera/bookmarks/clips) + Playhead. Supports collapse/expand for immersive mode (H key).

- [ ] **Step 5: Wire to playback store**

Click play → sends WS `play` command. Drag playhead → sends WS `seek`. Speed button → sends WS `play` with new speed.

- [ ] **Step 6: Manual test**

Play/pause works, dragging playhead seeks, speed changes work, H key toggles immersive mode.

- [ ] **Step 7: Commit**

```bash
git add wargame-replay/web/src/timeline/
git commit -m "feat: multi-track timeline with transport controls and immersive mode"
```

---

## Phase 4: Hotspot Engine + Director Mode

### Task 12: Hotspot Engine (Backend)

**Files:**
- Create: `wargame-replay/server/hotspot/engine.go`
- Create: `wargame-replay/server/hotspot/grid.go`
- Create: `wargame-replay/server/hotspot/cache.go`
- Create: `wargame-replay/server/hotspot/engine_test.go`

- [ ] **Step 1: Write hotspot engine test**

Test that `ComputeHotspots()` on the real db returns a non-empty timeline with scores in 0-1 range.

- [ ] **Step 2: Implement spatial grid**

`grid.go` — Divide coordinate space into 100m cells. Assign units to cells. Compute per-cell density.

- [ ] **Step 3: Implement hotspot scoring engine**

`engine.go` — Iterate all frames, compute HotScore per cell per second using density (0.25), velocity (0.15), events (0.40), statsΔ (0.20). Store Top-3 HotRegions per frame.

- [ ] **Step 4: Implement disk cache**

`cache.go` — Serialize/deserialize `[]HotspotFrame` to `<db>.hotspots.cache`. Check db mtime for invalidation.

- [ ] **Step 5: Run tests**

Run: `cd wargame-replay/server && go test ./hotspot/ -v -timeout 60s`
Expected: PASS, hotspot timeline computed.

- [ ] **Step 6: Wire hotspot into game.Service, REST API, and WebSocket frames**

Add `GET /api/games/:id/hotspots` endpoint. Extend `game.Service.GetFrame()` to attach the precomputed `HotspotInfo` for the requested timestamp (lookup from hotspot timeline). This populates the `Hotspot` field in the `Frame` struct, ensuring WebSocket frame pushes include hotspot data as specified.

- [ ] **Step 7: Commit**

```bash
git add wargame-replay/server/hotspot/ wargame-replay/server/api/ wargame-replay/server/game/
git commit -m "feat: hotspot engine with density/velocity/events scoring and disk cache"
```

---

### Task 13: Director Mode (Frontend)

**Files:**
- Create: `wargame-replay/web/src/director/DirectorPanel.tsx`
- Create: `wargame-replay/web/src/director/PreviewGrid.tsx`
- Create: `wargame-replay/web/src/director/AutoSwitch.tsx`
- Create: `wargame-replay/web/src/store/director.ts`

- [ ] **Step 1: Create director Zustand store**

`store/director.ts` — state: autoMode, currentCamera, previewCameras[4], hotspotScore, nextSwitchCountdown.

- [ ] **Step 2: Create PreviewGrid with Canvas 2D thumbnails**

4 small Canvas elements showing simplified unit dots at 2Hz. Each canvas receives a CameraPreset defining its viewport.

- [ ] **Step 3: Create AutoSwitch component**

Toggle auto/manual mode. Display current hotspot score bar, next switch countdown. In auto mode, apply director switching logic from hotspot data.

- [ ] **Step 4: Create DirectorPanel container**

Layout: main map (reuse MapView) + right sidebar with PreviewGrid + AutoSwitch + compact event feed.

- [ ] **Step 5: Wire mode switching in App**

Tab key or TopBar button switches between Replay and Director mode. Both share the same playback state and timeline.

- [ ] **Step 6: Manual test**

Switch to Director mode, see 4 preview thumbnails, auto mode switches camera based on hotspot data.

- [ ] **Step 7: Commit**

```bash
git add wargame-replay/web/src/director/ wargame-replay/web/src/store/director.ts
git commit -m "feat: director mode with preview grid and auto camera switching"
```

---

## Phase 5: Bookmarks + Clips

### Task 14: Bookmarks (Backend + Frontend)

**Files:**
- Create: `wargame-replay/server/api/bookmarks.go`
- Create: `wargame-replay/web/src/clips/BookmarkList.tsx`
- Create: `wargame-replay/web/src/store/clips.ts`

- [ ] **Step 1: Implement bookmark CRUD backend**

`api/bookmarks.go` — Read/write `<db>.bookmarks.json` sidecar file. CRUD endpoints. Auto-suggest bookmarks from hotspot score spikes.

- [ ] **Step 2: Create clips Zustand store**

`store/clips.ts` — bookmarks[], clips[], selectedClipId. CRUD actions that call backend API.

- [ ] **Step 3: Create BookmarkList component**

List of bookmarks with timestamp, title, tags. Click to seek. B key to add at current time. Delete button.

- [ ] **Step 4: Render bookmarks on timeline**

Green vertical lines on the bookmark track. Hover shows title.

- [ ] **Step 5: Manual test**

Press B to add bookmark, see it on timeline, click to jump, delete works.

- [ ] **Step 6: Commit**

```bash
git add wargame-replay/server/api/bookmarks.go wargame-replay/web/src/clips/ wargame-replay/web/src/store/clips.ts
git commit -m "feat: bookmark system with CRUD, auto-suggest, and timeline integration"
```

---

### Task 15: Clip Editor

**Files:**
- Create: `wargame-replay/server/api/clips.go`
- Create: `wargame-replay/web/src/clips/ClipEditor.tsx`
- Create: `wargame-replay/web/src/clips/ExportDialog.tsx`

- [ ] **Step 1: Implement clip CRUD backend**

`api/clips.go` — Read/write `<db>.clips.json`. CRUD + export (P0: JSON metadata, P1: full position data).

- [ ] **Step 2: Create ClipEditor component**

Drag on timeline to create clip region. Clip list with reorder, merge, split, delete. Edit title/speed per clip.

- [ ] **Step 3: Create ExportDialog**

Modal dialog: select export format (JSON meta / JSON+CSV data), download file.

- [ ] **Step 4: Render clips on timeline**

Purple regions on clip track. Deeper purple for overlaps. Click to select clip.

- [ ] **Step 5: Manual test**

Drag to create clip on timeline, edit title, reorder clips, export as JSON.

- [ ] **Step 6: Commit**

```bash
git add wargame-replay/server/api/clips.go wargame-replay/web/src/clips/
git commit -m "feat: clip editor with drag-create, CRUD, and P0/P1 export"
```

---

## Phase 6: Polish + Integration

### Task 16: Map Enhancements

**Files:**
- Create: `wargame-replay/web/src/map/TrailLayer.tsx`
- Modify: `wargame-replay/web/src/map/MapView.tsx`

- [ ] **Step 1: Add unit trail layer**

30-second trail lines behind each unit. Toggle with UI button.

- [ ] **Step 2: Add map style switcher**

Dark/Satellite/Terrain buttons in TopBar. Switch Mapbox style on click.

- [ ] **Step 3: Add unit selection + follow**

Click unit → select, show callsign label + stats overlay. Map follows selected unit.

- [ ] **Step 4: Add event toast overlay**

Floating kill/hit notifications in bottom-left corner, auto-fade after 3s.

- [ ] **Step 5: Commit**

```bash
git add wargame-replay/web/src/map/
git commit -m "feat: map enhancements - trails, style switcher, unit follow, event toasts"
```

---

### Task 17: Game Selection Screen

**Files:**
- Create: `wargame-replay/web/src/components/GameList.tsx`
- Modify: `wargame-replay/web/src/App.tsx`

- [ ] **Step 1: Create GameList component**

Fetch `/api/games`, display cards with session info, player count, time range. Click to load game.

- [ ] **Step 2: Wire into App routing**

No game selected → show GameList. Game selected → show replay UI. Back button returns to list.

- [ ] **Step 3: Commit**

```bash
git add wargame-replay/web/src/components/GameList.tsx wargame-replay/web/src/App.tsx
git commit -m "feat: game selection screen with activity list"
```

---

### Task 18: Static Build + Embed

**Files:**
- Modify: `wargame-replay/server/main.go`
- Create: `wargame-replay/Makefile`

- [ ] **Step 1: Add Go embed for frontend static files**

Build frontend with `npm run build`, embed `web/dist/` in Go binary using `embed.FS`. Serve from Gin.

- [ ] **Step 2: Create Makefile**

```makefile
.PHONY: build dev

build:
	cd web && npm run build
	cd server && go build -o ../wargame-replay .

dev:
	cd server && go run main.go --dir ../../ &
	cd web && npm run dev
```

- [ ] **Step 3: Test single binary**

```bash
make build
./wargame-replay --dir .
```

Open `http://localhost:8080` — should serve the frontend.

- [ ] **Step 4: Commit**

```bash
git add wargame-replay/Makefile wargame-replay/server/main.go
git commit -m "feat: single binary build with embedded frontend"
```

---

## Task Dependency Graph

```
Task 1 (Scaffold)
  ├── Task 2 (Scanner)
  ├── Task 3 (Position Decoder)
  │   ├── Task 3b (Event Decoder) ← P0, needed by Hotspot Engine
  │   └── Task 4 (Coord Resolver)
  └── Task 5 (Time Index + Cache)
       └── Task 6 (Game Service)
            ├── Task 7 (REST API)
            │   └── Task 8 (WebSocket)
            │        └── Task 9 (Frontend Shell)
            │             ├── Task 10 (Map View + RelativeCanvas fallback)
            │             └── Task 11 (Timeline)
            └── Task 12 (Hotspot Engine) ← depends on Task 3b (events)
                 ↓ patches Game Service to embed hotspot in Frame
                 └── Task 13 (Director Mode)

Task 14 (Bookmarks) — after Task 11
Task 15 (Clips) — after Task 14
Task 16 (Map Polish) — after Task 10
Task 17 (Game Select) — after Task 9
Task 18 (Build) — after all
```

**Note:** Task 12 must complete before the WebSocket frame contract is fully satisfied (hotspot field). Task 12's Step 6 patches `game.Service.GetFrame()` to include hotspot data, which flows through the existing WebSocket `sendFrame` path.

**Parallelizable tasks** (with subagent-driven-development):
- Tasks 2, 3, 3b, 5 can run in parallel (after Task 1)
- Tasks 10, 11 can run in parallel (after Task 9)
- Tasks 14, 16, 17 can run in parallel (after Task 11)
