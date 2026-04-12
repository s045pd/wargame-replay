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
cd server && go test -race ./...                   # all tests (race detector)
cd server && go test ./decoder -run TestDecode     # single test
cd server && CGO_ENABLED=1 go build -o ../wargame-replay .

# Frontend only
cd web && npx tsc -b                               # type check (strict: noUnusedLocals, erasableSyntaxOnly)
cd web && npm run lint                              # eslint (flat config, eslint 9)
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
- **`index/`** — `TimeIndex` provides binary-search frame lookup. `LRUCache` stores marshaled frame JSON (100MB limit).
- **`api/`** — Gin handlers. `Handler` struct holds `sync.RWMutex`-protected game list and lazy-loaded service map. Upload endpoint validates filename pattern, writes atomically (`.uploading` temp file → rename).
- **`ws/`** — Single WebSocket handler. `tickParams(speed)` calculates frame delivery rate, capping at ~16 fps for high speeds.

### Frontend Architecture

- **State**: Zustand stores — `playback.ts` (connection, frames, map UI, visual effects), `director.ts` (camera mode, focus, slowdown), `clips.ts` (bookmarks/clips), `hotspotFilter.ts` (visibility toggles).
- **Map layers**: 15 layers — `UnitLayer`, `TrailLayer`, `HotspotLayer`, `HotspotActivityCircle`, `BaseCampLayer`, `BombingLayer`, `POILayer`, `GraticuleLayer`, `SniperTracerLayer`, `EventToastOverlay`, `KillLeaderboard`, `PlayerSearch`, `HotspotControlPanel`, `RelativeCanvas`. Each receives the MapLibre `map` instance and data as props.
- **Unit icons**: Canvas-drawn at runtime (`unitIcons.ts`, `poiIcons.ts`) — 5 classes (rifle, mg, sniper, medic, marksman) × 2 teams × alive/dead. Registered via `map.addImage()`.
- **Director mode**: `useHotspotDirector` hook (450 LOC) auto-selects camera targets with pre-tracking (8s), focus mode (dark map + slowdown), cooldown (6s ±30% jitter), manual override priority.
- **WebSocket client** (`lib/ws.ts`): `GameWebSocket` class with auto-reconnect (2s). Playback store subscribes to `frame`/`state` messages.
- **Coordinate handling**: `coordMode` (`wgs84` | `relative`) flows from server meta; `MapView` for WGS84, `RelativeCanvas` for relative.
- **i18n**: `lib/i18n.ts` — Zustand store with `zh`/`en` locale, `t(key)` helper, `toggleLang()`.
- **TypeScript**: `import type * as maplibregl from 'maplibre-gl'` (not default import) due to `erasableSyntaxOnly` + `noUnusedLocals` in tsconfig.

### Sidecar Files

Each `.db` game file may have companion files in the same directory:
- `.hotspots.cache` — binary-encoded hotspot detection results
- `.clips.json` — user-created clips
- `.bookmarks.json` — user bookmarks
- `.unitclasses.json` — unit class assignments
- `.txt` — map metadata (coordinate calibration, graticule)

### Team Convention

Unit IDs < 500 = red team, ≥ 500 = blue team. This is hardcoded in `decoder/position.go:decodeTeam` and `game/service.go:buildPlayerList`.

### Binary Protocol

- **Position** (DT=1): 15 bytes/unit — ID(2) + Lat(4) + Lng(4) + Flags(5: alive, class, ammo, supply, revive)
- **Events** (DT=2/5): variable-length — kill/hit/revive/heal with attacker/victim IDs
- **POIs** (DT=8): 31 bytes/entry — ID, coords, type(base/vehicle/supply/control/station), team, resource
- **Graticule CR encoding**: `cr=0x100E` → high_byte+2=18 cols (R→A), low_byte+1=15 rows (1→15)

### Key Algorithms

- **Frame assembly**: 5s sliding window + HP reconciliation via binary search on event timeline — O(N × log E)
- **Hotspot detection**: temporal clustering (45s gap) → split (180s) → classify → spatial center (150m density) → deduplicate (30s+200m)
- **Auto-director**: pre-track(8s) → active hotspot collection → priority(critical>normal) → weighted random(score^1.5) → focus mode(seek+dark+slow+lock) → cooldown(6s±jitter)

## CI/CD

### CI Pipeline (ci.yml)

Triggered on push/PR to main:
1. `test-backend`: `go vet ./...` + `go test -race -count=1 ./...`
2. `test-frontend`: `tsc -b` + `npm run lint`
3. `build`: full build + smoke test (start server → kill)

**Note**: Backend tests that require a `.db` file use `os.Stat()` + `t.Skip()` so CI passes without test data.

### Release Pipeline (release.yml)

Triggered on tag `v*`:
1. 6-platform matrix build (Linux/macOS/Windows × x64/ARM64)
2. Cross-compilation via Zig CC (Linux + Windows targets)
3. Windows → `.zip`, Unix → `.tar.gz`
4. GitHub Release with checksums

### Version Control

```bash
make release V=v1.0.0      # tag + push → auto build + release
```

Version injected: `go build -ldflags="-X main.version=v1.0.0"`. Query via `GET /api/health`.

### Windows Executable Resources

`server/winres/` + `go-winres make --arch amd64,386,arm64` generates `.syso` files that `go build` auto-links into Windows binaries, embedding:
- Application icon (256px + 16px)
- Version metadata (FileDescription, ProductName, etc.)
- Manifest (DPI awareness, long path support)

## Repository Structure

This is a **git subtree** setup:
- Local repo root: parent directory containing `wargame-replay/` subdirectory
- Remote `origin/main`: flat structure (no `wargame-replay/` prefix)
- Push command: `git subtree push --prefix=wargame-replay origin main`

## Testing

### Backend Tests

```bash
cd server && go test -race ./...
```

Tests that need `.db` files have `os.Stat()` guard + `t.Skip()` — safe in CI without test data.

### Frontend Checks

```bash
cd web && npx tsc -b        # type checking
cd web && npm run lint       # eslint
```

No unit tests yet — lint + type check only.

### Smoke Test

CI builds the full binary and starts/stops it to verify the embed + serve cycle works:
```bash
./wargame-replay -port 0 &
sleep 1
kill %1
```

## Common Tasks

### Adding a new API endpoint

1. Add handler method to `api/*.go` (follow existing patterns)
2. Register route in `main.go` router setup
3. Add TypeScript types + fetch function in `web/src/lib/api.ts`
4. Connect to Zustand store or component

### Adding a new map layer

1. Create `web/src/map/NewLayer.tsx` component
2. Accept `map: maplibregl.Map` + data props
3. Use `useEffect` to add/update GeoJSON source + layer
4. Render in `MapView.tsx` alongside other layers

### Adding a hotspot type

1. Add classification logic in `hotspot/engine.go:classifyCluster()`
2. Add type string to `HotspotEvent.Type`
3. Update frontend type in `lib/api.ts`
4. Add icon/color in `map/HotspotLayer.tsx`
5. Add i18n key in `lib/i18n.ts`

## Branch Feature Matrix

This project ships on two branches. When implementing features or fixing bugs, check which branch(es) the change applies to:

### `main` — Local single-binary deployment (Go backend + embedded frontend)

Features **exclusive to `main`**:
- **Video sync (real-time transcoding)**: HEVC→H.264 on-the-fly via `ffmpeg` subprocess. Requires the Go binary running locally with access to the filesystem and ffmpeg. Frontend code in `web/src/video/VideoEngine.tsx` adds `?transcode=1&seek=N` for incompatible codecs.
- **Video source management**: Multi-source scanner (`server/video/`), directory browser API (`/api/videos/browse`), quick-add flow, sources persistence. All require the Go backend.
- **Video streaming**: `/api/video-stream/:token` — streams local files via HTTP Range or ffmpeg pipe. Needs local filesystem access.
- **File upload**: `POST /api/upload` for `.db` + `.txt` files writes to the local `-dir` directory.

### `gh-pages` — Static GitHub Pages deployment (frontend only)

Features **exclusive to `gh-pages`**:
- **Upload to GitHub**: `.db` and `.txt` files are uploaded to the GitHub repository via the GitHub API (no Go backend).
- **Static data loading**: Games are loaded from a predefined JSON manifest rather than scanned at runtime.

### Both branches (changes must be applied to **both**)

- **Hotspot system**: `store/hotspotFilter.ts`, `map/HotspotControlPanel.tsx`, `timeline/HotspotTrack.tsx`, `hooks/useHotspotDirector.ts`, `map/HotspotLayer.tsx`, `map/HotspotActivityCircle.tsx` — all hotspot UI, filtering, master toggle, and **personal hotspot events** are pure frontend.
- **Personal hotspot mode**: When following a unit, the hotspot track switches to personal events (kill/hit/killed/hit_recv/heal/revive). This is entirely in `web/src/` and applies to both branches.
- **Map layers**: `UnitLayer`, `TrailLayer`, `POILayer`, `BaseCampLayer`, `BombingLayer`, `GraticuleLayer`, `SniperTracerLayer`, etc.
- **Director mode**: `store/director.ts`, `hooks/useHotspotDirector.ts`, `director/DirectorPanel.tsx`
- **Clips & bookmarks UI**: `store/clips.ts`, `clips/BookmarkList.tsx`, `clips/ClipEditor.tsx`
- **Player search**: `map/PlayerSearch.tsx`
- **i18n**: `lib/i18n.ts` — all translation keys
- **Timeline**: `timeline/Timeline.tsx`, `timeline/HotspotTrack.tsx`, `timeline/TransportControls.tsx`
- **Settings**: `components/settings/`
- **Visual config**: `store/visualConfig.ts`

### Decision guide

| Change type | Apply to |
|---|---|
| Pure `web/src/` UI/store/component | **Both** branches |
| `server/` Go code | **main** only |
| Video sync (`web/src/video/`) | **main** only (depends on Go APIs) |
| Video sync UI that reads only from store (FloatingVideoCard, LayoutCell) | **main** only |
| Upload flow that uses GitHub API | **gh-pages** only |
| Upload flow that uses `POST /api/upload` | **main** only |
| Hotspot / director / map layer changes | **Both** branches |

### Regenerating Windows resources

```bash
cd server && go-winres make --arch amd64,386,arm64
```

Updates `.syso` files. Commit them — they're small (~24KB each).
