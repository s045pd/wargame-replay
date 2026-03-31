# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
# Full production build (frontend → embed → Go binary)
make build

# Development — run in two terminals:
cd server && go run . -dir ../../ -port 8081      # Go backend
cd web && npm run dev                              # Vite dev server (proxies /api, /ws → :8081)

# Backend only
cd server && go vet ./...                          # lint
cd server && go test ./...                         # all tests
cd server && go test ./decoder -run TestDecode     # single test
cd server && CGO_ENABLED=1 go build -o ../wargame-replay .

# Frontend only
cd web && npx tsc -b                               # type check (strict: noUnusedLocals, erasableSyntaxOnly)
cd web && npm run lint                              # eslint
cd web && npm run build                             # tsc -b + vite build → web/dist/
```

**CGO is required** — `mattn/go-sqlite3` needs a C compiler. Always `CGO_ENABLED=1`.

**Hotspot cache**: After modifying `hotspot/engine.go`, delete `*.hotspots.cache` sidecar files next to `.db` files or results will be stale. The cache is only invalidated when the `.db` file mtime is newer.

## Architecture

### Single-Binary Deployment

`server/embed.go` uses `//go:embed all:static` to bundle `server/static/` (copied from `web/dist/` during build) into the Go binary. `main.go` serves it via Gin's `NoRoute` handler with SPA fallback. The entire app is one executable.

### Data Flow

```
.db file (SQLite) → decoder (binary parsing) → game.Service (frame assembly) → REST/WebSocket → React frontend
```

**Frame assembly** (`game/service.go:GetFrame`): Position records contain only ~26 units each. The service accumulates records over a 5-second sliding window to reconstruct the full ~136+ unit state. HP is reconciled by comparing position-record timestamps against an HP-event timeline using binary search.

**WebSocket streaming** (`ws/stream.go`): The server drives playback — sends frames at intervals based on speed multiplier. Client sends `play`/`pause`/`seek` commands. `GetFrameRange(prevTs, ts)` collects events over skipped time during fast-forward.

### Backend Packages

- **`decoder/`** — Binary protocol parsing for position frames (DataType=1, 15-byte entries), events (DataType=2/5), POIs (DataType=8, 31-byte entries). Coordinate auto-detection tries 5 heuristics (sidecar `.txt`, various WGS84 encodings, relative fallback).
- **`game/`** — `Service` wraps a single `.db` file. Lazy-loaded via `api.Handler` with double-check locking under `sync.RWMutex`. Frame JSON cached in 100MB LRU. `collectEvents` uses binary search on sorted `hitTimestamps` for O(log N + K) lookup.
- **`hotspot/`** — Detection pipeline: temporal clustering (≤45s gap) → split long clusters (>180s) → score/classify → density-based center (150m radius) → deduplication (≥30s overlap + ≤200m). Results cached in `.hotspots.cache` sidecar files.
- **`scanner/`** — Scans directory for `.db` files matching `{session}_{YYYY-MM-DD-HH-MM-SS}_{YYYY-MM-DD-HH-MM-SS}.db`. Game ID = first 4 bytes of SHA256(filename) as hex.
- **`index/`** — `TimeIndex` provides binary-search frame lookup. `LRUCache` stores marshaled frame JSON.
- **`api/`** — Gin handlers. `Handler` struct holds `sync.RWMutex`-protected game list and lazy-loaded service map. Upload endpoint validates filename pattern, writes atomically (`.uploading` temp file → rename).
- **`ws/`** — Single WebSocket handler. `tickParams(speed)` calculates frame delivery rate, capping at ~16 fps for high speeds.

### Frontend Architecture

- **State**: Zustand stores — `playback.ts` (connection, frames, map UI), `director.ts` (camera mode), `clips.ts` (bookmarks/clips), `hotspotFilter.ts`, `i18n.ts` (zh/en).
- **Map layers**: Each layer (`UnitLayer`, `HotspotLayer`, `TrailLayer`, `POILayer`, `BaseCampLayer`, `BombingLayer`, `GraticuleLayer`) is a React component receiving the Mapbox `map` instance and data as props. Icons are Canvas-drawn at runtime (`unitIcons.ts`, `poiIcons.ts`) and registered via `map.addImage()`.
- **Director mode**: `useHotspotDirector` hook auto-selects camera targets from hotspot events. `DirectorPanel` shows preview grid + `HotspotEventTabs` (5 types: firefight, killstreak, mass_casualty, engagement, bombardment).
- **WebSocket client** (`lib/ws.ts`): `GameWebSocket` class with auto-reconnect (2s). Playback store subscribes to `frame`/`state` messages.
- **Coordinate handling**: `coordMode` (`wgs84` | `relative`) flows from server meta through the store; `MapView` renders for WGS84, `RelativeCanvas` for relative.
- **TypeScript**: `import type * as mapboxgl from 'mapbox-gl'` (not default import) due to `erasableSyntaxOnly` + `noUnusedLocals` in tsconfig.

### Sidecar Files

Each `.db` game file may have companion files in the same directory:
- `.hotspots.cache` — binary-encoded hotspot detection results
- `.clips.json` — user-created clips
- `.bookmarks.json` — user bookmarks
- `.unitclasses.json` — unit class assignments
- `.txt` — map metadata (coordinate calibration, graticule)

### Team Convention

Unit IDs < 500 = red team, ≥ 500 = blue team. This is hardcoded in `decoder/position.go:decodeTeam` and `game/service.go:buildPlayerList`.
