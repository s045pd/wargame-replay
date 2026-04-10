# Video Sync (Multi-Camera Co-Tracking) Implementation Plan

**Goal:** Ship the Phase 1 MVP of the video sync feature: `-videodir` scanning, sidecar JSON association, playback-clock following, floating video card UI, and AlignWizard for initial setup.

**Spec:** `docs/superpowers/specs/2026-04-10-video-sync-design.md`

**Tech Stack:** Go 1.22 + Gin + custom mp4 parser; React 19 + Zustand + TypeScript strict + MapLibre (existing); HTML5 `<video>` for playback.

---

## File Structure

### New Files — Backend

| File | Responsibility |
|------|----------------|
| `server/video/types.go` | `VideoGroup`, `VideoSegment`, `IndexEntry`, `CandidateGroup`, sidecar envelope |
| `server/video/parser.go` | Minimal mp4 box reader: `ftyp`, `moov.mvhd`, `moov.trak.mdia.minf.stbl.stsd` |
| `server/video/scanner.go` | Recursive directory walk + per-file `parser.Parse` |
| `server/video/index.go` | In-memory sorted segment store + time-range query |
| `server/video/group.go` | Auto-grouping heuristic for continuous segments |
| `server/video/align.go` | TZ normalization (game local secs ↔ Unix ms) + `findSegment` |
| `server/video/sidecar.go` | Atomic JSON read/write for `{db}.videos.json` |
| `server/video/parser_test.go` | Tests against `testdata/tiny.mp4` |
| `server/video/scanner_test.go` | Recursive walk test |
| `server/video/group_test.go` | Auto-grouping heuristic tests |
| `server/video/align_test.go` | TZ + segment lookup tests |
| `server/video/sidecar_test.go` | JSON round-trip + atomic write tests |
| `server/video/testdata/tiny.mp4` | ~20 KB h264 fixture committed into repo |
| `server/api/videos.go` | CRUD handlers + candidates + status + rescan |
| `server/api/video_stream.go` | `/api/video-stream/*relPath` Range handler |
| `server/api/videos_test.go` | Handler tests using `httptest` |

### New Files — Frontend

| File | Responsibility |
|------|----------------|
| `web/src/store/videos.ts` | Zustand store for candidates / groups / active IDs / card states |
| `web/src/video/VideoEngine.tsx` | Headless component driving all active `<video>` DOM |
| `web/src/video/VideoPanel.tsx` | Absolute-positioned container for floating cards |
| `web/src/video/FloatingVideoCard.tsx` | One draggable, resizable, minimizable card |
| `web/src/video/VideoManager.tsx` | Right-side drawer |
| `web/src/video/VideoGroupCard.tsx` | Row for an existing associated group |
| `web/src/video/CandidateGroupCard.tsx` | Row for an unassociated auto-group |
| `web/src/video/AlignWizard.tsx` | 3-step modal |
| `web/src/video/alignMath.ts` | `parseGameTs`, `findSegment`, `clamp` helpers |

### Modified Files

| File | Changes |
|------|---------|
| `server/main.go` | `-videodir` flag + scanner init + new routes |
| `server/api/handler.go` | `videoRoot`, `videoIndex` fields |
| `server/api/upload.go` | DeleteGame removes `.videos.json` |
| `web/src/lib/api.ts` | New types + fetchers |
| `web/src/store/playback.ts` | Optional: export `subscribe` helper (Zustand already supports) |
| `web/src/App.tsx` | Mount `<VideoEngine />` and `<VideoPanel />`, add VideoManager toggle |
| `web/src/components/TopBar.tsx` | New "video" button (existing pattern) |
| `web/src/lib/i18n.ts` | New zh / en keys |

---

## Phase 1: Backend Foundation

### Task 1: Create `video` package types

**Files:** Create `server/video/types.go`.

- [ ] Define `VideoSegment`, `VideoGroup`, `IndexEntry`, `CandidateGroup`, `sidecarEnvelope`, `Status` types exactly as documented in the spec §"Data Model".
- [ ] Define codec whitelist helper: `func IsCompatibleCodec(codec string) bool` returning true for `h264`, `avc1`, `av1`, `av01`, `vp9`.
- [ ] Add package-level const `SidecarSuffix = ".videos.json"`.
- [ ] Add `SidecarVersion = 1`.

**Verify:** `go vet ./server/video/` passes.

---

### Task 2: Minimal mp4 parser

**Files:** Create `server/video/parser.go`, `parser_test.go`, `testdata/tiny.mp4`.

The parser reads only the boxes needed: top-level `ftyp` to verify container, then walks into `moov → mvhd` for `creation_time` and `duration`, plus `moov → trak → mdia → minf → stbl → stsd` for the first video sample entry (codec).

- [ ] **Step 1:** Write `parser.go` with this API:
  ```go
  type Metadata struct {
      CreationTime time.Time
      DurationMs   int64
      Codec        string
      Width        int
      Height       int
  }
  func Parse(path string) (Metadata, error)
  ```
- [ ] **Step 2:** Implement `Parse` as:
  - Open file, wrap in `bufio.Reader`.
  - Loop reading 8-byte box headers `(size uint32, type [4]byte)`.
  - For `size == 1`: read extended 8-byte size.
  - For `size == 0`: box extends to EOF.
  - Recognize only `ftyp`, `moov`, `mvhd`, `trak`, `mdia`, `minf`, `stbl`, `stsd` (+ video sample entries `avc1`, `hev1`, `hvc1`, `vp09`, `av01`).
  - For non-recognized containers, skip via `file.Seek(offset + size)`.
  - For `mvhd`:
    - Read `version uint8`, skip `flags [3]byte`
    - If `version == 0`: `creation_time uint32` (1904 epoch) + `modification_time uint32` + `timescale uint32` + `duration uint32`
    - If `version == 1`: 64-bit variants
    - Convert creation_time to `time.Time` (seconds since 1904-01-01T00:00:00Z, subtract 2082844800 to get Unix seconds)
    - `DurationMs = duration * 1000 / timescale`
  - For `stsd`: skip version+flags+entryCount, read first entry header `(size uint32, fourcc [4]byte)`, map fourcc to codec name (`avc1→h264`, `hev1→hevc`, `hvc1→hevc`, `vp09→vp9`, `av01→av1`, others → `fourcc` lowercase). Then for the video sample entry body: skip 6 reserved + 2 data_ref_index + 16 reserved, read `width uint16`, `height uint16`.
- [ ] **Step 3:** Add `testdata/tiny.mp4` — use ffmpeg locally once to generate:
  ```bash
  ffmpeg -f lavfi -i color=red:size=320x240:rate=1 -t 1 -c:v libx264 \
         -pix_fmt yuv420p -movflags +faststart testdata/tiny.mp4
  ```
  Commit the result (expect ~5–20 KB).
- [ ] **Step 4:** Write `parser_test.go`:
  ```go
  func TestParseTinyMp4(t *testing.T) {
      m, err := Parse("testdata/tiny.mp4")
      if err != nil { t.Fatal(err) }
      if m.Codec != "h264" { t.Errorf("codec: %s", m.Codec) }
      if m.Width != 320 || m.Height != 240 { ... }
      if m.DurationMs < 500 || m.DurationMs > 1500 { ... }
  }
  func TestParseInvalid(t *testing.T) {
      _, err := Parse("testdata/nonexistent.mp4")
      if err == nil { t.Fatal("expected error") }
  }
  ```
- [ ] **Step 5:** Also gate `TestParseTinyMp4` with `if _, err := os.Stat(...); err != nil { t.Skip("fixture missing") }` so CI without the fixture still runs.

**Verify:** `cd server && go test -race ./video/`.

---

### Task 3: Scanner + Index

**Files:** Create `server/video/scanner.go`, `server/video/index.go`, `scanner_test.go`.

- [ ] **Step 1:** Implement `Index`:
  ```go
  type Index struct {
      mu      sync.RWMutex
      entries []IndexEntry   // sorted by StartTs ascending
      byPath  map[string]int // relPath → entries index
  }
  func NewIndex() *Index
  func (idx *Index) Replace(entries []IndexEntry)  // sort + rebuild byPath
  func (idx *Index) Lookup(relPath string) (IndexEntry, bool)
  func (idx *Index) FindOverlapping(start, end time.Time) []IndexEntry
  func (idx *Index) Count() int
  ```
  `FindOverlapping` uses `sort.Search` to find the first entry whose `StartTs + DurationMs >= start`, then linear-scans forward while `entry.StartTs <= end`.
- [ ] **Step 2:** Implement `Scanner`:
  ```go
  type Scanner struct {
      rootDir string
      index   *Index
      mu      sync.Mutex
      scanning bool
      lastScanAt time.Time
  }
  func NewScanner(rootDir string) *Scanner  // rootDir = "" → disabled
  func (s *Scanner) Enabled() bool
  func (s *Scanner) RootDir() string
  func (s *Scanner) Index() *Index
  func (s *Scanner) Scanning() bool
  func (s *Scanner) LastScanAt() time.Time
  func (s *Scanner) Scan() error
  ```
  `Scan` recursively walks `rootDir`, for each file whose extension is in `{.mp4, .m4v, .mov}` (case-insensitive): compute relPath, open + parse metadata (skip silently on parse error with a `log.Printf` warning), build `IndexEntry`, append to slice. At end, `idx.Replace(slice)`.
- [ ] **Step 3:** Write `scanner_test.go`:
  - `TestScannerDisabled` — `NewScanner("").Enabled()` is false
  - `TestScannerWithTestdata` — `NewScanner("testdata").Scan()` finds at least 1 entry if `tiny.mp4` exists, else `t.Skip`
- [ ] **Step 4:** Write `index_test.go` (tests for `Replace`, `Lookup`, `FindOverlapping` with synthetic entries, no fixture needed).

**Verify:** `cd server && go test -race ./video/`.

---

### Task 4: Auto-grouping heuristic

**Files:** Create `server/video/group.go`, `group_test.go`.

- [ ] **Step 1:** Implement `AutoGroup`:
  ```go
  func AutoGroup(entries []IndexEntry) []CandidateGroup
  ```
  Algorithm:
  1. Sort by `(filepath.Dir(relPath), filenamePrefix, StartTs)`. `filenamePrefix` = first 4 ASCII chars of `filepath.Base(relPath)` without extension (captures `GX01`, `DJI_`, etc.)
  2. Iterate linearly; start a new group when any of these differ from the previous entry:
     - `filepath.Dir(relPath)` changes
     - `filenamePrefix` changes
     - `Codec` changes
     - `(Width, Height)` changes
     - Gap `(current.StartTs - (prev.StartTs + prev.DurationMs))` > `1 * time.Second`
  3. For each group, fill `CandidateGroup`:
     - `AutoGroupKey = filepath.Join(dir, prefix)`
     - `Segments = []VideoSegment` (convert each IndexEntry to VideoSegment, set `Compatible = IsCompatibleCodec(codec)`)
     - `TotalDurationMs = sum of durations`
     - `Codec = first segment's codec`
     - `Compatible = all segments compatible`
- [ ] **Step 2:** Write tests:
  - `TestAutoGroup_Continuous` — 3 entries same dir/prefix/codec, gap 0.5s → 1 group of 3
  - `TestAutoGroup_DirBreak` — different dirs → separate groups
  - `TestAutoGroup_CodecBreak` — same dir, h264 then hevc → 2 groups
  - `TestAutoGroup_GapBreak` — gap of 5s → 2 groups
  - `TestAutoGroup_Empty` — empty input → empty output

**Verify:** `go test -race ./video/`.

---

### Task 5: Alignment helpers

**Files:** Create `server/video/align.go`, `align_test.go`.

- [ ] **Step 1:** Implement:
  ```go
  // Game timestamps are "YYYY-MM-DD HH:MM:SS" local time (from scanner.go:50-58).
  func ParseGameTsUnixMs(ts string, loc *time.Location) (int64, error)

  // FindSegment picks the segment that contains videoMs (absolute Unix ms in video space).
  // Returns nil if out of range.
  func FindSegment(segments []VideoSegment, videoMs int64) (seg *VideoSegment, index int)

  // SegmentStartMs returns the Unix ms of segment's StartTs.
  func SegmentStartMs(seg *VideoSegment) int64

  // CalcOffsetMs from one reference point: gameMs = videoMs + offsetMs.
  func CalcOffsetMs(referenceGameMs int64, referenceVideoMs int64) int64
  ```
- [ ] **Step 2:** Write tests:
  - `TestParseGameTsUnixMs` — `"2026-03-28 12:15:07"` with `time.Local` → valid ms
  - `TestFindSegment_Inside` — videoMs in the middle of segment → returns it
  - `TestFindSegment_Boundary` — at start / at end → correct segment
  - `TestFindSegment_Gap` — between segments → nil
  - `TestFindSegment_BeforeFirst` / `AfterLast` → nil
  - `TestCalcOffsetMs` — positive + negative offsets

**Verify:** `go test -race ./video/`.

---

### Task 6: Sidecar I/O

**Files:** Create `server/video/sidecar.go`, `sidecar_test.go`.

- [ ] **Step 1:** Implement:
  ```go
  // SidecarPath returns {dbPath}.videos.json.
  func SidecarPath(dbPath string) string

  // LoadSidecar returns empty groups if file missing; returns error only on read/parse failure.
  func LoadSidecar(dbPath string) ([]VideoGroup, error)

  // SaveSidecar writes atomically. If groups is empty, removes the file.
  func SaveSidecar(dbPath string, gameID string, groups []VideoGroup) error

  // AddGroup / UpdateGroup / DeleteGroup mutate sidecar in place, atomically.
  func AddGroup(dbPath string, gameID string, g VideoGroup) (VideoGroup, error)
  func UpdateGroup(dbPath string, gameID string, groupID string, patch func(*VideoGroup)) error
  func DeleteGroup(dbPath string, gameID string, groupID string) error
  ```
- [ ] **Step 2:** Use the `.uploading` temp-rename pattern matching `server/api/upload.go:158-191` and `server/hotspot/cache.go:56-74`.
- [ ] **Step 3:** Write tests using `t.TempDir()`:
  - round-trip save/load
  - empty sidecar after `DeleteGroup` of the last group
  - partial update via `UpdateGroup`
  - AddGroup generates a UUID if none provided

**Verify:** `go test -race ./video/`.

---

### Task 7: HTTP handlers

**Files:** Create `server/api/videos.go`, `server/api/video_stream.go`, `server/api/videos_test.go`. Modify `server/api/handler.go`.

- [ ] **Step 1:** Add fields on `Handler`:
  ```go
  type Handler struct {
      // ... existing ...
      videoRoot    string        // "" if disabled
      videoScanner *video.Scanner // nil if disabled
  }
  ```
  Add constructor param or setter.
- [ ] **Step 2:** Write `videos.go` handlers:
  - `GetVideoStatus(c *gin.Context)` → `{ enabled, rootDir, segmentCount, lastScanAt, scanning }`
  - `PostVideoRescan(c *gin.Context)` → runs `scanner.Scan()`, returns new status
  - `GetVideoCandidates(c *gin.Context)` — path param `:id`:
    - Look up the game by ID (existing `h.findGame`)
    - Parse game's StartTime / EndTime (already `time.Time` in `GameInfo`? check; if string, parse with `time.ParseInLocation` in `time.Local`)
    - `entries := scanner.Index().FindOverlapping(start, end)`
    - `candidates := video.AutoGroup(entries)`
    - Return `{ candidates }`
  - `GetVideoGroups(c *gin.Context)` — loads sidecar for that `.db`
  - `PostVideoGroup(c *gin.Context)` — body:
    ```json
    { "unitId": int, "cameraLabel": string, "offsetMs": int64,
      "segmentRelPaths": [string], "notes": string }
    ```
    Look up each relPath in index, build `VideoGroup` with enriched segments, assign a new UUID via `crypto/rand`, write via `AddGroup`, return the saved group.
  - `PutVideoGroup(c *gin.Context)` — path param `:groupId`, partial update
  - `DeleteVideoGroup(c *gin.Context)` — path param `:groupId`
- [ ] **Step 3:** Write `video_stream.go`:
  ```go
  func (h *Handler) StreamVideo(c *gin.Context) {
      if h.videoRoot == "" {
          c.AbortWithStatus(http.StatusNotFound); return
      }
      relPath := strings.TrimPrefix(c.Param("relPath"), "/")
      clean := filepath.Clean("/" + relPath)
      if len(clean) < 2 { c.AbortWithStatus(http.StatusBadRequest); return }
      clean = clean[1:]
      if strings.Contains(clean, "..") || filepath.IsAbs(clean) {
          c.AbortWithStatus(http.StatusBadRequest); return
      }
      absPath := filepath.Join(h.videoRoot, clean)
      realAbs, err := filepath.EvalSymlinks(absPath)
      if err != nil { c.AbortWithStatus(http.StatusNotFound); return }
      rootReal, _ := filepath.EvalSymlinks(h.videoRoot)
      if !strings.HasPrefix(realAbs, rootReal+string(filepath.Separator)) &&
         realAbs != rootReal {
          c.AbortWithStatus(http.StatusForbidden); return
      }
      f, err := os.Open(realAbs)
      if err != nil { c.AbortWithStatus(http.StatusNotFound); return }
      defer f.Close()
      stat, _ := f.Stat()
      c.Header("Content-Type", mimeTypeForExt(realAbs))
      c.Header("Accept-Ranges", "bytes")
      http.ServeContent(c.Writer, c.Request, stat.Name(), stat.ModTime(), f)
  }

  func mimeTypeForExt(p string) string {
      switch strings.ToLower(filepath.Ext(p)) {
      case ".mp4", ".m4v": return "video/mp4"
      case ".mov":         return "video/quicktime"
      case ".mkv":         return "video/x-matroska"
      }
      return "application/octet-stream"
  }
  ```
- [ ] **Step 4:** Modify `server/api/upload.go` DeleteGame handler (~line 286–328) to also:
  ```go
  os.Remove(game.FilePath + video.SidecarSuffix)
  ```
- [ ] **Step 5:** Write `videos_test.go` using `httptest.NewRecorder`:
  - `TestGetVideoStatus_Disabled` / `_Enabled`
  - `TestStreamVideo_PathTraversal` (`..`, absolute paths, symlink escape) → 400/403
  - `TestStreamVideo_NotFound` → 404
  - `TestStreamVideo_Range` — using `testdata/tiny.mp4`, request `Range: bytes=0-99` → 206 + 100 bytes
  - `TestGetCandidates` / `TestPostGroup` / `TestPutGroup` / `TestDeleteGroup` — end-to-end sidecar flow with an in-memory scanner

**Verify:** `cd server && go test -race ./api/ ./video/` and `go vet ./...`.

---

### Task 8: Wire up `main.go`

**Files:** Modify `server/main.go`.

- [ ] **Step 1:** Add flag:
  ```go
  videoDir := flag.String("videodir", "", "Root directory for video sync feature (empty = auto: {dir}/videos)")
  ```
- [ ] **Step 2:** Resolve the effective root:
  ```go
  effectiveVideoDir := *videoDir
  if effectiveVideoDir == "" {
      candidate := filepath.Join(*dir, "videos")
      if st, err := os.Stat(candidate); err == nil && st.IsDir() {
          effectiveVideoDir = candidate
      }
  }
  ```
- [ ] **Step 3:** Construct scanner and run initial scan synchronously. Log `"video: indexed N segments from <dir>"` or `"video: feature disabled (no -videodir)"`.
- [ ] **Step 4:** Pass `videoRoot` and `scanner` into the `api.Handler`.
- [ ] **Step 5:** Register routes:
  ```go
  r.GET("/api/videos/status", h.GetVideoStatus)
  r.POST("/api/videos/rescan", h.PostVideoRescan)
  r.GET("/api/games/:id/videos/candidates", h.GetVideoCandidates)
  r.GET("/api/games/:id/videos", h.GetVideoGroups)
  r.POST("/api/games/:id/videos", h.PostVideoGroup)
  r.PUT("/api/games/:id/videos/:groupId", h.PutVideoGroup)
  r.DELETE("/api/games/:id/videos/:groupId", h.DeleteVideoGroup)
  r.GET("/api/video-stream/*relPath", h.StreamVideo)
  ```

**Verify:**
- `cd server && go vet ./... && go test -race ./...`
- `cd server && CGO_ENABLED=1 go build -o /tmp/wgr-test .`
- `/tmp/wgr-test -port 0 &` — should start, log video status; kill

---

### Task 9: Backend commit

- [ ] Create a commit titled:
  ```
  feat(video): add scanner, alignment, sidecar, and HTTP handlers for video sync
  ```
  Include all files added in Tasks 1–8.

---

## Phase 2: Frontend Store + Engine

### Task 10: Extend `lib/api.ts`

**Files:** Modify `web/src/lib/api.ts`.

- [ ] **Step 1:** Add TS types (copy from spec §"Frontend"):
  - `VideoSegment`, `VideoGroup`, `CandidateGroup`, `VideoStatus`
- [ ] **Step 2:** Add fetchers:
  ```typescript
  export async function getVideoStatus(): Promise<VideoStatus>
  export async function rescanVideos(): Promise<VideoStatus>
  export async function getVideoCandidates(gameId: string): Promise<{ candidates: CandidateGroup[] }>
  export async function getVideoGroups(gameId: string): Promise<{ groups: VideoGroup[] }>
  export async function createVideoGroup(gameId: string, body: {...}): Promise<VideoGroup>
  export async function updateVideoGroup(gameId: string, groupId: string, patch: {...}): Promise<VideoGroup>
  export async function deleteVideoGroup(gameId: string, groupId: string): Promise<void>
  ```
- [ ] **Step 3:** Helper for streaming URL:
  ```typescript
  export function videoStreamUrl(relPath: string): string {
    // forward slashes already; only need to encodeURI component-wise preserving /
    const parts = relPath.split('/').map(encodeURIComponent);
    return `${BASE}/api/video-stream/${parts.join('/')}`;
  }
  ```

**Verify:** `cd web && npx tsc -b`.

---

### Task 11: Create `store/videos.ts`

**Files:** Create `web/src/store/videos.ts`.

- [ ] **Step 1:** State:
  ```typescript
  interface CardState { x: number; y: number; w: number; h: number; minimized: boolean; muted: boolean; }

  interface VideosState {
    serverEnabled: boolean;
    rootDir: string;
    segmentCount: number;
    scanning: boolean;

    gameId: string | null;
    candidates: CandidateGroup[];
    candidatesLoading: boolean;

    groups: VideoGroup[];
    groupsLoading: boolean;

    activeGroupIds: string[];
    layoutMode: 'floating';               // MVP only
    cardStates: Record<string, CardState>;

    autoActivateOnSelect: boolean;

    // Actions
    loadStatus(): Promise<void>;
    rescan(): Promise<void>;
    loadForGame(gameId: string): Promise<void>;
    createGroup(payload: { unitId: number; cameraLabel: string; offsetMs: number; segmentRelPaths: string[]; notes?: string }): Promise<void>;
    updateGroup(groupId: string, patch: Partial<VideoGroup>): Promise<void>;
    deleteGroup(groupId: string): Promise<void>;
    setActive(groupId: string, active: boolean): void;
    setActiveGroupIds(ids: string[]): void;
    updateCardState(groupId: string, patch: Partial<CardState>): void;
    setAutoActivate(v: boolean): void;
  }
  ```
- [ ] **Step 2:** Implement with `zustand` + `localStorage` persistence for `cardStates`, `layoutMode`, `activeGroupIds` (keyed by `gameId`), and `autoActivateOnSelect`.
- [ ] **Step 3:** At the end of `create<VideosState>(...)`, wire the auto-activation subscription to `usePlayback`:
  ```typescript
  usePlayback.subscribe((state) => {
    const s = useVideos.getState();
    if (!s.autoActivateOnSelect) return;
    const id = state.selectedUnitId;
    if (id === null) return;
    const matching = s.groups.filter((g) => g.unitId === id);
    if (matching.length) s.setActiveGroupIds(matching.map((g) => g.id));
  });
  ```
  Do this once in a side-effect registered from `App.tsx` to avoid circular import; see Task 18.

**Verify:** `cd web && npx tsc -b`.

---

### Task 12: Alignment math helpers

**Files:** Create `web/src/video/alignMath.ts`.

- [ ] **Step 1:** Implement:
  ```typescript
  // Parse "YYYY-MM-DD HH:MM:SS" as local time; returns Unix ms.
  export function parseGameTs(ts: string): number

  // Given segments sorted ascending, find one covering videoMs. Returns null if none.
  export function findSegment(
    segments: VideoSegment[],
    videoMs: number,
  ): { segment: VideoSegment; index: number; segStartMs: number } | null

  export function clamp(v: number, min: number, max: number): number

  export function segmentStartMs(s: VideoSegment): number
  ```
- [ ] **Step 2:** `parseGameTs` implementation without regex (strict slice + `Date`):
  ```typescript
  export function parseGameTs(ts: string): number {
    // "2026-03-28 12:15:07" → local time Unix ms
    const [d, t] = ts.split(' ');
    if (!d || !t) return NaN;
    const [y, mo, da] = d.split('-').map(Number);
    const [h, mi, s] = t.split(':').map(Number);
    return new Date(y, mo - 1, da, h, mi, s).getTime();
  }
  ```

**Verify:** `tsc -b` passes.

---

### Task 13: `VideoEngine.tsx`

**Files:** Create `web/src/video/VideoEngine.tsx`.

- [ ] **Step 1:** Headless component:
  ```typescript
  export function VideoEngine() {
    const currentTs = usePlayback((s) => s.currentTs);
    const playing   = usePlayback((s) => s.playing);
    const speed     = usePlayback((s) => s.speed);
    const activeIds = useVideos((s) => s.activeGroupIds);
    const groups    = useVideos((s) => s.groups);

    useEffect(() => {
      const active = groups.filter((g) => activeIds.includes(g.id));
      for (const g of active) {
        syncOne(g, currentTs, playing, speed);
      }
    }, [currentTs, playing, speed, activeIds, groups]);

    return null;
  }
  ```
- [ ] **Step 2:** `syncOne` per spec §"Frontend Playback Engine". Look up the `<video>` by id via `document.getElementById('wgr-video-' + groupId)` or a module-level `Map<string, HTMLVideoElement>` (register/unregister from `FloatingVideoCard`).
- [ ] **Step 3:** Preload next segment:
  ```typescript
  function preloadNext(segments: VideoSegment[], current: VideoSegment) {
    const i = segments.indexOf(current);
    const next = segments[i + 1];
    if (!next) return;
    const hint = document.createElement('link');
    hint.rel = 'preload';
    hint.as = 'video';
    hint.href = videoStreamUrl(next.relPath);
    document.head.appendChild(hint);
    // Remove older hints to avoid leaks (keep only last 4)
  }
  ```

**Verify:** `tsc -b`.

---

### Task 14: `FloatingVideoCard.tsx`, `VideoPanel.tsx`

**Files:** Create both.

- [ ] **Step 1:** `VideoPanel.tsx` — absolute-positioned root `<div className="pointer-events-none absolute inset-0 z-40">` mapping `activeGroupIds` → `<FloatingVideoCard key={id} groupId={id} />`.
- [ ] **Step 2:** `FloatingVideoCard.tsx`:
  - Reads `group` via `useVideos((s) => s.groups.find(...))`
  - Reads `cardState` with defaults (right-bottom, 320×180)
  - Draggable: pointer-move updates `x`/`y`, persisted via `updateCardState`
  - Resizable: bottom-right handle with `resize: both`
  - `<video id={'wgr-video-' + groupId} muted={cardState.muted} playsInline preload="auto" />`
  - Registers the DOM node with the `VideoEngine` module map in `useEffect` (mount) and unregisters on unmount
  - Header: colored dot (red if `unitId < 500` else blue) + unit label (from `playback.players` lookup) + camera label + buttons: mute toggle, minimize, close
  - On close: `setActive(groupId, false)`
- [ ] **Step 3:** Card width/height should respect `minimized` (only header visible when minimized).

**Verify:** `tsc -b`, `npm run lint`.

---

## Phase 3: Frontend UI

### Task 15: `VideoManager.tsx` + sub-cards

**Files:** Create `web/src/video/VideoManager.tsx`, `VideoGroupCard.tsx`, `CandidateGroupCard.tsx`.

- [ ] **Step 1:** `VideoManager.tsx` — right-drawer (`fixed right-0 top-0 h-full w-[420px] bg-zinc-900/95 border-l border-zinc-800 z-50 backdrop-blur`):
  - Header: title + close button + [Rescan] button
  - Status line: `status.enabled ? 'N videos indexed' : 'Video feature disabled'`
  - Section "Associated" → list `groups.map((g) => <VideoGroupCard key={g.id} group={g} />)`
  - Section "Candidates" → list `candidates.map((c) => <CandidateGroupCard key={c.autoGroupKey} candidate={c} onAssociate={() => openAlignWizard(c)} />)`
  - Toggle for `autoActivateOnSelect`
- [ ] **Step 2:** `VideoGroupCard.tsx`:
  - Colored dot + unit name (look up via `playback.players`) + camera label
  - Activate toggle (`setActive(group.id, !active)`)
  - Offset display with buttons: `−10s / −1s / −0.1s / +0.1s / +1s / +10s` (call `updateGroup`)
  - Segment summary: count + total duration
  - `[Edit label]` inline edit
  - `[Delete]` with confirm
- [ ] **Step 3:** `CandidateGroupCard.tsx`:
  - Auto group key + segment count + total duration
  - Codec + compatibility badge (warning if incompatible)
  - `[Associate]` button opens AlignWizard with preloaded segments
- [ ] **Step 4:** i18n keys added in `lib/i18n.ts` (at least `zh` + `en`).

**Verify:** `tsc -b`, `npm run lint`.

---

### Task 16: `AlignWizard.tsx`

**Files:** Create `web/src/video/AlignWizard.tsx`.

- [ ] **Step 1:** Full-screen modal, 3 steps, internal state:
  ```typescript
  const [step, setStep] = useState<1|2|3>(1);
  const [unitId, setUnitId] = useState<number|null>(null);
  const [cameraLabel, setCameraLabel] = useState('');
  const [offsetMs, setOffsetMs] = useState<number>(() => initialOffsetMs(candidate));
  ```
- [ ] **Step 2:** Step 1 UI:
  - Unit search list (reuse `PlayerSearch` or render simplified list from `playback.players`)
  - Camera label text input + chip suggestions: `["头戴 FPV", "肩戴", "胸前", "第三人称", "无人机"]` (i18n-aware)
- [ ] **Step 3:** Step 2 UI:
  - Shows auto-detected `candidate.segments[0].startTs`
  - Displays computed initial offset: "视频比游戏早 N 秒" (negative offset) / "晚 N 秒"
  - Collapsible "精准校正" section:
    - Left: top 10 kill events for the selected unit (fetched from `/api/games/:id/kills?unit=<id>`) rendered as clickable list — on click, the game side of the reference pair becomes that event's timestamp
    - Right: a local-only `<video>` preview showing the first segment with `± 1 / ± 0.1 s` scrubber — the local time scrubbed becomes the video side of the reference pair
    - Below: live `offsetMs = referenceGameMs - referenceVideoAbsoluteMs`
  - "跳过 (使用自动值)" button
- [ ] **Step 4:** Step 3 UI:
  - Summary (unit / label / offset human-readable / segment count / total duration / codec / compatibility)
  - `[确认]` → calls `createGroup(...)`, closes modal
- [ ] **Step 5:** Use `initialOffsetMs(candidate)` helper that returns `0` if candidate has no `startTs`, else `parseGameTs(gameStart) - segmentStartMs(candidate.segments[0])`.
- [ ] **Step 6:** i18n for every label.

**Verify:** `tsc -b`, `npm run lint`.

---

### Task 17: Integrate into `App.tsx` + `TopBar.tsx`

**Files:** Modify `App.tsx`, `TopBar.tsx`.

- [ ] **Step 1:** In `App.tsx`:
  - On mount: `useVideos.getState().loadStatus()`
  - On `gameId` change: `useVideos.getState().loadForGame(gameId)`
  - State `const [showVideoManager, setShowVideoManager] = useState(false)`
  - Mount `<VideoEngine />` once (null-rendering)
  - Mount `<VideoPanel />` inside the map container div
  - Mount `<VideoManager open={showVideoManager} onClose={() => setShowVideoManager(false)} />`
  - Register the auto-activate subscription once in `useEffect(() => { return subscribeAutoActivate(); }, [])` (returns unsubscribe)
- [ ] **Step 2:** In `TopBar.tsx` add a video icon button:
  - Visible when `useVideos((s) => s.serverEnabled)`
  - On click `onShowVideoManager()`
  - Icon: `lucide-react` `Film` or `Video`
- [ ] **Step 3:** Pass `onShowVideoManager` prop from `App.tsx`.

**Verify:** `tsc -b`, `npm run lint`, `npm run build`.

---

### Task 18: i18n entries

**Files:** Modify `web/src/lib/i18n.ts`.

- [ ] Add at least:
  ```
  zh: {
    'video.manager.title': '视频同轨',
    'video.manager.associated': '已关联',
    'video.manager.candidates': '候选视频',
    'video.manager.noCandidates': '未发现匹配的视频文件',
    'video.manager.rescan': '重新扫描',
    'video.manager.disabled': '视频功能已禁用（启动时未指定 -videodir）',
    'video.manager.autoActivate': '选中角色自动激活视角',
    'video.card.mute': '静音',
    'video.card.unmute': '取消静音',
    'video.card.minimize': '最小化',
    'video.card.close': '关闭',
    'video.wizard.step1': '这段视频属于谁？',
    'video.wizard.step2': '对齐视频和游戏时间',
    'video.wizard.step3': '确认并保存',
    'video.wizard.suggestions.head': '头戴 FPV',
    'video.wizard.suggestions.shoulder': '肩戴',
    'video.wizard.suggestions.chest': '胸前',
    'video.wizard.suggestions.third': '第三人称',
    'video.wizard.suggestions.drone': '无人机',
    'video.wizard.skip': '跳过（使用自动值）',
    'video.wizard.confirm': '确认',
    'video.error.incompatible': '浏览器不支持该编码',
    'video.error.missing': '文件丢失',
    'video.error.outOfRange': '当前时间不在视频范围内',
  }
  // en: mirror of the above
  ```

**Verify:** `tsc -b`, `npm run lint`.

---

## Phase 4: Final Verification

### Task 19: End-to-end build + smoke test

- [ ] `cd server && go vet ./...`
- [ ] `cd server && go test -race -count=1 ./...`
- [ ] `cd web && npx tsc -b`
- [ ] `cd web && npm run lint`
- [ ] `cd web && npm run build`
- [ ] `make build` from repo root
- [ ] Start `./wargame-replay -port 0 &`, curl `/api/videos/status`, kill

---

### Task 20: Final commit + spec update

- [ ] Mark the Phase 1 deliverables in the spec doc as `[x]`
- [ ] One final commit:
  ```
  feat(video): phase 1 MVP — scanner, alignment, sidecar, playback, UI
  ```
  squash-style or separate commits per phase (use judgment, but never `--no-verify`).

---

## Notes for the Executor

- Go tests that depend on `testdata/tiny.mp4` must gate with `os.Stat + t.Skip` so CI without the fixture still runs (matches `CLAUDE.md` guidance).
- Never use `--no-verify` or `--no-gpg-sign`.
- Commit frequently at clean boundaries (each Task forms a reasonable commit).
- The custom mp4 parser must handle **both** version 0 and version 1 of `mvhd`. Version 0 covers ~99% of real-world files but version 1 shows up in longer recordings.
- When `playbackRate > 16`, do not try to set it — clamp to 16 and let the game clock drive repeated seeks ("frame-step mode"). This is the right behavior for `speed = 32, 64, 128` in wargame's existing playback.
- Do not add new npm dependencies for video playback. Use the native `<video>` element.
- Do not add any new Go dependencies. The mp4 parser must be written from scratch, ~200–400 LOC.
- Keep `<video>` elements `muted` and `playsInline`, otherwise Safari auto-play will fail.
