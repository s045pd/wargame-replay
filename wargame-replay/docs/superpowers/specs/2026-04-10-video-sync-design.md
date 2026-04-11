# Video Sync (Multi-Camera Co-Tracking) Design Spec

**Date:** 2026-04-10
**Status:** Implemented (Phase 1 shipped in commits 4c48bf4 + 29cfa2d)
**Author:** designed via brainstorming session

## Overview

Add a **video sync** capability to wargame-replay so that a user who recorded in-game footage (head-mounted / shoulder-mounted cameras, multiple angles, multiple teammates) can co-track those videos against a recorded `.db` game session. When the user selects a unit during replay, the corresponding first-person video appears; when multiple angles exist, the user can see a multi-view layout.

Videos stay **where the user already keeps them on disk** — the platform does not copy, upload, or move files. A single server-side flag (`-videodir`) points at a root directory, the scanner builds an in-memory index, and sidecar JSON files record which clips belong to which `unit` in which game.

## Goals

1. **Discover** local video files (mp4 / mkv / mov) under a configured root directory without uploading.
2. **Auto-group** continuously-recorded segments (GoPro / DJI split a long recording into multiple files every 4 GB or 30 min).
3. **Suggest** candidate videos for each `.db` game based on time-range overlap.
4. **Associate** a video group with a specific `unitId` + free-text `cameraLabel`, with an editable `offsetMs` correction.
5. **Align** videos to the game clock automatically using mp4 `creation_time`, and let the user refine with a three-step wizard.
6. **Playback** active video groups as floating overlay cards that follow the existing playback clock, with seamless segment transitions and speed / seek / pause parity.
7. **Auto-activate** the currently selected unit's videos, so "pick my teammate" naturally shows their viewpoint.
8. **Degrade gracefully** on incompatible codecs, missing files, out-of-range timestamps, and huge directories.

## Non-Goals (MVP / Phase 1)

- **No transcoding.** Server does not run ffmpeg. Incompatible codecs (HEVC on Firefox, ProRes, etc.) show an error with a user-run ffmpeg command.
- **No thumbnails, no timeline previews.** Phase 3.
- **No upload API.** Files stay in place.
- **No layout switching.** Phase 1 ships the **floating-card** layout only. Split and grid layouts come in Phase 2.
- **No manual grouping UI.** Phase 1 relies on the auto-grouping heuristic. Manual split / merge of groups comes in Phase 2.
- **No audio mixing.** Videos are muted by default; unmuting a single card is allowed.
- **No persistent scan cache.** Full in-memory scan at startup. Incremental cache comes in Phase 2.
- **No clip / bookmark integration.** Exporting a game clip with its attached video is Phase 2.
- **No multi-user / remote scenarios.** Single-user local tool, matching wargame-replay's existing posture.

## Architecture at a Glance

```
Startup (-videodir /path/to/videos)
   │
   ▼
[VideoScanner]  recursive walk, parse mp4 moov box with a minimal Go parser
   │            → creation_time / duration / codec / width / height / file_mtime
   ▼
[VideoIndex]   in-memory, sorted by startTs, supports time-range queries
   │
   ├─→ GET /api/games/:id/videos/candidates
   │     returns segments whose [startTs, startTs+dur] overlaps the game's [start, end],
   │     already auto-grouped by filename prefix + codec + continuity
   │
   └─→ user associates a group via AlignWizard
         │
         ▼
[Sidecar]  {db_path}.videos.json     ← persistent VideoGroup[] (like .clips.json)
```

At playback time:

```
WebSocket frame msg (currentTs)          ← authoritative game clock (playback.ts)
   │
   ▼
VideoEngine.syncFrame(currentTs, playing, speed)
   │   for each active VideoGroup:
   │     1. videoMs = gameMs - group.offsetMs
   │     2. find segment covering videoMs
   │     3. if segment changed → <video>.src = /api/video-stream/{relPath}
   │     4. if |video.currentTime - targetLocal| > 0.2s → seek
   │     5. sync play/pause/playbackRate (clamped to [0.0625, 16])
   ▼
HTML5 <video> → Range request → /api/video-stream/*relPath → http.ServeContent
```

## Component & File Plan

### Backend (Go)

| New / Modified | Path | Purpose |
|---|---|---|
| **NEW pkg** | `server/video/types.go` | `VideoGroup`, `VideoSegment`, `IndexEntry`, JSON envelope types |
| **NEW pkg** | `server/video/parser.go` | Minimal mp4 box parser (reads `moov.mvhd` for times, `moov.trak.mdia.minf.stbl.stsd` for codec). No external dependency. |
| **NEW pkg** | `server/video/scanner.go` | Recursive directory walk, builds `VideoIndex` |
| **NEW pkg** | `server/video/index.go` | In-memory index, time-range lookup, relPath lookup |
| **NEW pkg** | `server/video/group.go` | Auto-grouping heuristic (filename prefix + codec + continuity ≤ 1s gap) |
| **NEW pkg** | `server/video/align.go` | Time zone normalization (game local secs ↔ mp4 UTC ms), segment finder, drift math |
| **NEW pkg** | `server/video/sidecar.go` | Atomic read/write of `{db}.videos.json`, list operations |
| **NEW pkg** | `server/video/scanner_test.go`, `parser_test.go`, `align_test.go`, `group_test.go`, `sidecar_test.go` | Unit tests for each file; fixture mp4 in `testdata/` |
| **NEW handler** | `server/api/videos.go` | `/api/videos/status`, `/api/videos/rescan`, `/api/games/:id/videos/candidates`, `/api/games/:id/videos` CRUD |
| **NEW handler** | `server/api/video_stream.go` | `/api/video-stream/*relPath` with `http.ServeContent`, path-safety triple check |
| **Modify** | `server/main.go` | Add `-videodir` flag, construct `video.Scanner`, run initial scan, pass to handler, register routes |
| **Modify** | `server/api/handler.go` | Add `videoRoot string` and `videoIndex *video.Index` fields on `Handler` |
| **Modify** | `server/api/upload.go` DeleteGame | Also `os.Remove(game.FilePath + ".videos.json")` |

### Frontend (React + TypeScript)

| New / Modified | Path | Purpose |
|---|---|---|
| **NEW** | `web/src/store/videos.ts` | Zustand store: candidates, groups, active IDs, layout mode, card states, CRUD actions |
| **NEW** | `web/src/video/VideoEngine.tsx` | Headless component. Subscribes to `playback.currentTs` and `videos.activeGroupIds`, drives `<video>` DOM |
| **NEW** | `web/src/video/FloatingVideoCard.tsx` | Draggable, resizable, minimizable card wrapping one `<video>` |
| **NEW** | `web/src/video/VideoPanel.tsx` | Container that holds all floating cards, relative to MapView |
| **NEW** | `web/src/video/VideoManager.tsx` | Right-side drawer: candidates, groups, activate toggles, offset adjuster, delete |
| **NEW** | `web/src/video/AlignWizard.tsx` | 3-step modal: pick unit + camera label → align via reference event → confirm |
| **NEW** | `web/src/video/VideoGroupCard.tsx` | Row component inside VideoManager for an existing group |
| **NEW** | `web/src/video/CandidateGroupCard.tsx` | Row component for a discovered, not-yet-associated auto-group |
| **Modify** | `web/src/lib/api.ts` | Add TS types + fetchers: `getVideoStatus`, `getCandidates`, `getGroups`, `createGroup`, `updateGroup`, `deleteGroup`, `rescanVideos` |
| **Modify** | `web/src/store/playback.ts` | Expose a Zustand selector pattern for `currentTs` change subscribers (already emits, no behavior change needed); optionally subscribe to `selectedUnitId` and trigger auto-activate in the videos store |
| **Modify** | `web/src/App.tsx` | Mount `<VideoEngine />` and `<VideoPanel />` once at the root, add VideoManager toggle in TopBar |
| **Modify** | `web/src/TopBar.tsx` (or equivalent) | Add video icon button next to existing action buttons, visible only if `videos.serverEnabled` |
| **Modify** | `web/src/lib/i18n.ts` | Add `zh`/`en` strings for all video-related UI |

## Data Model

### Backend

```go
// server/video/types.go

type VideoGroup struct {
    ID          string         `json:"id"`           // uuid v4
    UnitID      int            `json:"unitId"`
    CameraLabel string         `json:"cameraLabel"`  // free text, e.g. "Head FPV"
    OffsetMs    int64          `json:"offsetMs"`     // gameMs = videoMs + offsetMs
    Segments    []VideoSegment `json:"segments"`     // sorted by StartTs ascending
    CreatedAt   time.Time      `json:"createdAt"`
    UpdatedAt   time.Time      `json:"updatedAt"`
    Notes       string         `json:"notes,omitempty"`
}

type VideoSegment struct {
    RelPath       string    `json:"relPath"`       // relative to videoRoot, forward slashes
    StartTs       time.Time  `json:"startTs"`      // from moov.mvhd creation_time (UTC)
    DurationMs    int64      `json:"durationMs"`
    Codec         string     `json:"codec"`        // "h264" | "hevc" | "av1" | ""
    Width         int        `json:"width"`
    Height        int        `json:"height"`
    FileSizeBytes int64      `json:"fileSizeBytes"`
    FileMTime     time.Time  `json:"fileMTime"`    // used for stale detection
    Compatible    bool       `json:"compatible"`   // true if codec ∈ {h264, av1, vp9}
}

type sidecarEnvelope struct {
    Version int           `json:"version"` // 1
    GameID  string        `json:"gameId"`
    Groups  []VideoGroup  `json:"groups"`
}

type IndexEntry struct {
    RelPath       string
    AbsPath       string
    StartTs       time.Time
    DurationMs    int64
    Codec         string
    Width         int
    Height        int
    FileSizeBytes int64
    FileMTime     time.Time
}

type CandidateGroup struct {
    AutoGroupKey    string        `json:"autoGroupKey"`   // "alice_head/GX01" heuristic
    Segments        []VideoSegment `json:"segments"`      // already enriched from IndexEntry
    TotalDurationMs int64         `json:"totalDurationMs"`
    Codec           string        `json:"codec"`
    Compatible      bool          `json:"compatible"`
}
```

### Sidecar JSON (`{db_path}.videos.json`)

```json
{
  "version": 1,
  "gameId": "abc123",
  "groups": [
    {
      "id": "8f3c-...",
      "unitId": 42,
      "cameraLabel": "Head FPV",
      "offsetMs": -1234567,
      "segments": [
        {
          "relPath": "wargame/2026-03-28/alice_head/GX010001.MP4",
          "startTs": "2026-03-28T12:15:07Z",
          "durationMs": 1800000,
          "codec": "h264",
          "width": 1920,
          "height": 1080,
          "fileSizeBytes": 3221225472,
          "fileMTime": "2026-03-28T18:02:13Z",
          "compatible": true
        }
      ],
      "createdAt": "2026-04-10T14:23:11Z",
      "updatedAt": "2026-04-10T14:23:11Z"
    }
  ]
}
```

### Frontend (`web/src/lib/api.ts`)

```typescript
export interface VideoSegment {
  relPath: string;
  startTs: string;
  durationMs: number;
  codec: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  fileMTime: string;
  compatible: boolean;
}

export interface VideoGroup {
  id: string;
  unitId: number;
  cameraLabel: string;
  offsetMs: number;
  segments: VideoSegment[];
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface CandidateGroup {
  autoGroupKey: string;
  segments: VideoSegment[];
  totalDurationMs: number;
  codec: string;
  compatible: boolean;
}

export interface VideoStatus {
  enabled: boolean;
  rootDir: string;
  segmentCount: number;
  lastScanAt: string | null;
  scanning: boolean;
}
```

### Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| `cameraLabel` type | Free text | Camera setups are unpredictable; a suggestion list in the UI is enough |
| Time zone handling | Normalize both sides to Unix ms in `video/align.go` | Game timestamps are local seconds (no TZ suffix); mp4 `creation_time` is epoch-based. Convert both to Unix ms, never compare strings |
| `offsetMs` sign | `gameMs = videoMs + offsetMs` | Negative offset means video is earlier than game, matches intuition |
| Continuous-segment threshold | gap ≤ 1000 ms AND same codec AND same resolution | Matches GoPro / DJI auto-split behavior |
| Stored path form | Relative to `-videodir`, forward slashes | Portable across OSs, easy to validate |
| Index storage | In-memory, rebuilt on `-videodir` change or `POST /api/videos/rescan` | MVP: 10k videos * ~10 ms parse each < 2 min. SQLite / disk cache is Phase 2 |
| mp4 parsing | Custom minimal parser (no external dependency) | Only needs `moov.mvhd` + optional `stsd` for codec. Keeps `go.mod` clean and avoids supply-chain risk |
| Segment → video DOM mapping | One `<video>` per `VideoGroup` (not per segment) | Segments inside a group share a DOM node, we only change `.src` when crossing boundaries |
| Drift-correction threshold | 200 ms | Game clock is 1 s granular, 200 ms is imperceptible yet avoids seek thrashing |
| Speed clamping | `playbackRate ∈ [0.0625, 16]` | Browser limit; higher game speeds degrade into "frame-step" mode (each currentTs tick just seeks) |

## Backend API Endpoints

All mounted on the existing Gin router in `main.go`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/videos/status` | `{ enabled, rootDir, segmentCount, lastScanAt, scanning }` |
| `POST` | `/api/videos/rescan` | Blocking rescan of the root directory |
| `GET` | `/api/games/:id/videos/candidates` | Returns `CandidateGroup[]` whose time range overlaps the game's time range |
| `GET` | `/api/games/:id/videos` | Returns `{ groups: VideoGroup[] }` from sidecar (empty if file missing) |
| `POST` | `/api/games/:id/videos` | Body: `{ unitId, cameraLabel, offsetMs, segmentRelPaths: string[], notes? }`. Server looks up segments in index, fills metadata, writes sidecar, returns full `VideoGroup` |
| `PUT` | `/api/games/:id/videos/:groupId` | Body: `{ unitId?, cameraLabel?, offsetMs?, notes?, segmentRelPaths? }`. Partial update |
| `DELETE` | `/api/games/:id/videos/:groupId` | Removes one group from sidecar; deletes sidecar if empty |
| `GET` | `/api/video-stream/*relPath` | HTTP Range streaming via `http.ServeContent`. Triple-checks path safety |

### Path Safety (`video_stream.go`)

```go
relPath := strings.TrimPrefix(c.Param("relPath"), "/")
clean := filepath.Clean("/" + relPath)[1:]
if strings.Contains(clean, "..") || filepath.IsAbs(clean) {
    c.AbortWithStatus(http.StatusBadRequest); return
}
absPath := filepath.Join(h.videoRoot, clean)
realAbs, err := filepath.EvalSymlinks(absPath)
if err != nil || !strings.HasPrefix(realAbs, h.videoRoot+string(filepath.Separator)) {
    c.AbortWithStatus(http.StatusForbidden); return
}
// then http.ServeContent
```

## Frontend Playback Engine

### `VideoEngine.tsx` — single instance mounted in `App.tsx`

```typescript
export function VideoEngine() {
  const currentTs = usePlayback((s) => s.currentTs);
  const playing   = usePlayback((s) => s.playing);
  const speed     = usePlayback((s) => s.speed);
  const groups    = useVideos((s) => s.groups);
  const activeIds = useVideos((s) => s.activeGroupIds);

  useEffect(() => {
    const active = groups.filter((g) => activeIds.includes(g.id));
    for (const g of active) syncOne(g, currentTs, playing, speed);
  }, [currentTs, playing, speed, groups, activeIds]);

  return null;
}
```

`syncOne` algorithm (simplified):

```typescript
function syncOne(g, currentTs, playing, speed) {
  const gameMs  = parseGameTs(currentTs);             // local secs → Unix ms
  const videoMs = gameMs - g.offsetMs;                // absolute position in video timeline
  const seg     = findSegment(g.segments, videoMs);
  const videoEl = getVideoElement(g.id);

  if (!seg) { showPlaceholder(g.id, 'out-of-range'); return; }

  const targetSrc = `/api/video-stream/${encodeRel(seg.relPath)}`;
  if (videoEl.dataset.currentRelPath !== seg.relPath) {
    videoEl.src = targetSrc;
    videoEl.dataset.currentRelPath = seg.relPath;
    preloadNext(g.segments, seg);
  }

  const targetLocal = (videoMs - seg.startMs) / 1000;
  if (Math.abs(videoEl.currentTime - targetLocal) > 0.2) {
    videoEl.currentTime = targetLocal;
  }

  if (playing && videoEl.paused)   void videoEl.play().catch(onPlayError);
  if (!playing && !videoEl.paused) videoEl.pause();
  videoEl.playbackRate = clamp(speed, 0.0625, 16);
}
```

**Single source of truth:** the video tracks the game clock. It never emits seek / play / pause events that would drive the game.

## UI Flow

### Entry point

A new "video" icon button in `TopBar.tsx`, visible only when `videos.serverEnabled`. Clicking opens the **VideoManager** right-side drawer (~420 px wide).

### VideoManager drawer

```
VideoManager
├─ 📼 Associated (N groups)
│   └─ VideoGroupCard × N
│       ├─ unit-colored dot + unit name + camera label
│       ├─ [activate toggle]
│       ├─ [edit offset (±10s / ±1s / ±100ms)]
│       ├─ [delete] [edit label]
│       └─ segments summary (count + total duration)
└─ 🎞️ Candidates (M auto-groups)
    └─ CandidateGroupCard × M
        ├─ "alice_head / GX01..." (auto group key)
        ├─ total duration + codec + compatibility badge
        └─ [Associate] button → AlignWizard
```

### AlignWizard (3 steps, modal)

**Step 1 — Unit + label**
- Unit picker (reuses `PlayerSearch` component or shows a simplified list from `/api/games/:id/meta`)
- Camera label free-text input + common suggestions: "Head FPV" / "Shoulder" / "Chest" / "Third-person" / "Drone"

**Step 2 — Timestamp alignment**
- Auto-detected `creation_time` + initial offset prefilled
- "Refine" section (collapsible):
  - Left: list of prominent game events (first kill for this unit / reference explosions / hotspots)
  - Right: video preview with frame scrubber (`±1 frame` buttons + timeline)
  - As user adjusts, `offsetMs` preview updates live
- User can click "Skip (use auto value)" to accept the default

**Step 3 — Confirm**
- Summary: unit / camera label / offsetMs / segment count / total duration / codec / compatibility
- `POST /api/games/:id/videos`

### FloatingVideoCard

Absolute-positioned card rendered inside a `<VideoPanel>` wrapper. Default: bottom-right, 320×180 px. Header: colored dot + unit name + camera label + `[🔊]` mute toggle + `[—]` minimize + `[×]` close. Body: `<video muted playsinline preload="auto">`. Persistent position / size in `videos.cardStates[groupId]` → localStorage.

### Auto-activation on unit selection

```typescript
// registered in videos store init
usePlayback.subscribe(
  (s) => s.selectedUnitId,
  (unitId, prev) => {
    if (!get().autoActivateOnSelect) return;
    if (unitId === prev || unitId == null) return;
    const matching = get().groups.filter((g) => g.unitId === unitId);
    if (matching.length) get().setActiveGroupIds(matching.map((g) => g.id));
  }
);
```

A toggle in VideoManager controls `autoActivateOnSelect` (default `true`).

## Error Handling & Edge Cases

| Scenario | Behavior |
|---|---|
| `-videodir` not passed or empty / not a directory | `status.enabled = false`, no UI entry shown, no errors logged beyond a single info line |
| `.db` has no overlapping segments | Candidates list empty, VideoManager shows "No matching video files" |
| mp4 file parse error | Skip file, log warning, continue scanning |
| Incompatible codec (e.g. HEVC) | `compatible: false` flag. UI warns in AlignWizard and at playback. Error state shows ffmpeg command |
| `<video>.onerror` at runtime | Card shows red placeholder + "File not playable" message. Other groups unaffected |
| File moved / deleted after association | `/api/video-stream` 404 → card shows "File missing", group auto-flagged stale. Data is NOT auto-removed |
| Symlink escape attempt in URL | `EvalSymlinks` rejects, returns 403 |
| `..` or absolute path in URL | 400 Bad Request |
| `creation_time` far from game time (device clock off) | AlignWizard shows large offset; user can refine manually |
| Time zone mismatch | Both sides normalized to Unix ms before arithmetic, so TZ labels never matter |
| Browser concurrent `<video>` limit | Cap at 4 simultaneously active groups, show banner if user tries to activate a 5th |
| `speed > 16` | `playbackRate` capped at 16, higher speeds degrade into frame-step mode (each game tick seeks the video) |
| Large `-videodir` (10k+ files) | Blocking scan at startup, `/api/videos/status` reports `scanning: true` while running. Phase 2 moves this async |

## Testing Strategy

### Backend unit tests (`server/video/*_test.go`)

Pure, no external fixtures (CI-safe):

- `TestParseGameTsToUnixMs` — local secs string → Unix ms
- `TestFindSegment` — segment lookup boundary cases (start / middle / end / gap)
- `TestAutoGroupSegments` — heuristic correctly groups continuous segments, splits on gap / codec / resolution change
- `TestVideoGroupJSONRoundTrip` — sidecar JSON stability across reads
- `TestCleanRelPathSecurity` — `..`, absolute paths, symlink escapes all rejected
- `TestOffsetSemantics` — positive / negative offsets
- `TestAddRemoveGroup` — sidecar in-place edits preserve unrelated groups

Fixture-dependent tests (gated by `os.Stat + t.Skip`):

- `TestParseMp4MoovMvhd` — reads a tiny h264 mp4 fixture (~20 KB) in `testdata/tiny.mp4`, extracts `creation_time`, `duration`, `width`, `height`, `codec`
- `TestScannerRecursive` — walks `testdata/`, returns N index entries

### Backend API tests (`server/api/videos_test.go`)

Using `httptest.NewRecorder`:

- happy path for each endpoint
- 404 for missing game
- 400 for bad payload
- 403 for path-escape attempts on `/api/video-stream/*`
- sidecar atomic-write correctness

### Frontend verification

- `npx tsc -b` strict mode passes
- `npm run lint` passes
- Manual smoke test once CI is green:
  - Start server with `-videodir` pointing at a small sample dir
  - Open UI → VideoManager → verify candidates appear
  - Run AlignWizard → verify sidecar created
  - Verify floating card plays, seeks follow game clock, segment transitions are seamless

### CI smoke test (extends existing `ci.yml`)

In the `test-backend` job, after `go test`, start the binary with `-videodir server/video/testdata`, then:
- `curl /api/videos/status` → `enabled: true`
- `curl -H 'Range: bytes=0-1023' /api/video-stream/tiny.mp4` → 206 Partial Content + correct byte count

## Phase 1 Deliverables Checklist

- [x] `-videodir` flag recognized, scanner runs at startup, logs "N segments indexed"
- [x] `/api/videos/status`, `/rescan`, `/games/:id/videos/candidates`, `/games/:id/videos` CRUD, `/video-stream/*` all green with tests
- [x] Sidecar `.videos.json` created / updated / deleted atomically; DeleteGame cleans it up
- [x] Auto-grouping heuristic recognizes GoPro / DJI style split files
- [x] VideoManager drawer enumerates candidates and associated groups
- [x] AlignWizard 3-step flow works and writes valid sidecar
- [x] Activating a group spawns a FloatingVideoCard
- [x] FloatingVideoCard follows `currentTs`, handles play / pause / seek / speed
- [x] Segment transitions seamless (next-segment preload)
- [x] Selecting a unit auto-activates its groups (toggle in VideoManager)
- [x] Incompatible codec / missing file / out-of-range errors are clear, not crashes
- [x] Deleting a game removes its `.videos.json`
- [x] `go test -race ./...` green, `go vet ./...` green
- [x] `npx tsc -b` green, `npm run lint` green for all new code
- [x] `make build` succeeds and the binary starts

**End-to-end verification** (commit 29cfa2d):
- Real 5h45m `.db` + 3 ffmpeg-generated continuous mp4 segments
- `/api/videos/status` → enabled, 3 segments indexed
- `/api/games/:id/videos/candidates` → 1 auto-group with 3 continuous segments
- POST → valid UUID, complete sidecar JSON with chinese camera label
- PUT → partial offset update with fresh updatedAt
- DELETE → `{deleted: id}` and sidecar removed from disk
- `GET /api/video-stream/<rel>` with `Range: bytes=0-99` → 206 + 100 bytes
- Path traversal attempts (encoded `..`, absolute, `.`) → 400
- Nonexistent file → 404

## Phase 2 Outline

1. Split and grid layouts + layout switcher; layout preference persisted per game in sidecar or localStorage
2. Broken-link detection banner + manual re-association dialog
3. Batch alignment: select N groups, align one, auto-offset the rest via `creation_time` deltas
4. Manual split / merge of auto-groups
5. Clip export integrated with attached videos (optional ffmpeg)
6. Incremental scan cache `{videoDir}/.wargame-video-index.json`
7. Async scan progress (`/api/videos/scan-progress` + SSE / WebSocket)
8. Keyboard shortcuts: `V`, `Shift+V`, `[`, `]`
9. Multi-camera shared offset for simultaneous multi-lens devices

## Phase 3 Outline

1. Optional ffmpeg transcoding pipeline for incompatible codecs
2. Thumbnail + timeline preview frames (ffmpeg -ss sampling)
3. Audio mixing across multiple active cards
4. Multi-view sync lock (scrubbing one video moves the game clock)
5. MKV / AVI / MTS container support
6. Cross-game reuse (a long recording that spans two `.db` sessions)

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Time zone mismatches cause off-by-hours alignment | Never compare strings; normalize both sides to Unix ms in one place (`align.go`). AlignWizard always lets user refine |
| Minimal mp4 parser misreads exotic containers | Start with `ftyp` check; fall back to "unknown codec, compatible = false" gracefully. Unit test against real fixtures |
| Browser chokes on 4K HEVC / multi-stream | Cap active groups at 4; explicit codec compatibility flag; user-guidance for transcoding |
| Huge `-videodir` blocks startup | Log progress, MVP is blocking; Phase 2 adds async scan + cache |
| File moved mid-session | `onerror` handler + UI feedback; no auto-cleanup to avoid data loss on temporary unmounts |
| Symlink escape attack | `filepath.EvalSymlinks` + root prefix check, unit-tested |
| `<video>.src` rapid reassignment causes network thrash | Only reassign when `relPath` actually changes; preload next segment proactively |

## Implementation Order (for the plan doc)

1. `video/types.go` + `video/parser.go` (with tests) — the hardest infrastructural piece
2. `video/scanner.go` + `video/index.go` + `video/group.go` (with tests)
3. `video/sidecar.go` + `video/align.go` (with tests)
4. `api/videos.go` + `api/video_stream.go` (with handler tests)
5. `main.go` flag + wiring; verify via `curl`
6. Frontend `lib/api.ts` types & fetchers
7. `store/videos.ts`
8. `VideoEngine.tsx` + `FloatingVideoCard.tsx` + `VideoPanel.tsx`
9. `VideoManager.tsx` + `CandidateGroupCard.tsx` + `VideoGroupCard.tsx`
10. `AlignWizard.tsx`
11. Integration with `App.tsx`, `TopBar.tsx`, `playback.ts` auto-activate subscription
12. i18n strings
13. Final `make build`, manual smoke test, commit

Each step commits independently, builds cleanly, and tests pass before moving on.
