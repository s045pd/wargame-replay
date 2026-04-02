# Settings Panel & Launcher Optimization Design Spec

**Date:** 2026-04-02
**Status:** Approved

## Overview

Two independent features:
1. **Comprehensive Settings Panel** — a full-screen modal with 8 tabs exposing ~70 configurable parameters, supporting import/export/reset/JSON editing
2. **Executable Launcher Optimization** — auto-open browser in Chrome/Edge `--app` kiosk mode, hide terminal on Windows/macOS

---

## Part 1: Settings Panel

### 1.1 Entry Point & State Ownership

Gear icon button in TopBar, placed immediately left of the existing `?` (shortcuts) button. Same visual style: `w-6 h-6` zinc-800 border button. Keyboard shortcut: `,` (comma).

**State ownership:** The `showSettings: boolean` state lives in `App.tsx` (matching existing pattern for `showShortcuts`, `showBookmarks`, `showClipEditor`). Passed to TopBar as `onShowSettings` callback prop. TopBar's gear button calls this callback; TopBar does NOT own the open/close state.

### 1.2 Panel Layout

Full-screen modal overlay (`fixed inset-0 z-60 backdrop-blur`). Structure:

```
+---------------------------------------------------+
| Settings                                      [X] |
+--------+------------------------------------------+
| Tab 1  |                                          |
| Tab 2  |        Tab Content Area                  |
| Tab 3  |        (scrollable)                      |
| Tab 4  |                                          |
| Tab 5  |                                          |
| Tab 6  |                                          |
| Tab 7  |                                          |
| Tab 8  |                                          |
+--------+------------------------------------------+
```

Left sidebar: vertical tab list (icons + labels). Content area: scrollable. Dark theme consistent with existing UI.

### 1.3 Store Architecture

#### New Store: `useVisualConfig` (`/web/src/store/visualConfig.ts`)

Manages all NEW fine-grained visual parameters (~45 fields). Persisted to localStorage key `'wargame-visual'`.

```typescript
interface VisualConfig {
  // ── Map ──
  globeProjection: boolean;       // default: true
  introAnimation: boolean;        // default: true
  introDuration: number;          // default: 3.5 (seconds, range 1-8)
  introPitch: number;             // default: 50 (degrees, range 0-60)
  introBearing: number;           // default: -15 (degrees, range -180 to 180)
  maxZoom: number;                // default: 18 (range 10-22)
  boundsPadding: number;          // default: 15 (percentage, range 5-30)

  // ── Colors ──
  redTeamColor: string;           // default: '#ff4444'
  redDeadColor: string;           // default: '#661111'
  blueTeamColor: string;          // default: '#00ccff'
  blueDeadColor: string;          // default: '#115566'
  killLineColor: string;          // default: '#ff0000'
  hitLineColor: string;           // default: '#ffaa00'
  redTrailColor: string;          // default: '#ff4444'
  blueTrailColor: string;         // default: '#00ccff'
  sniperTracerColor: string;      // default: '#00ffcc'
  bombingColor: string;           // default: '#ff6600'
  selectionColor: string;         // default: '#ffffff'
  hotspotCircleColor: string;     // default: '#ffaa00'

  // ── Units ──
  unitIconSize: number;           // default: 32 (px, range 16-64)
  showUnitLabel: boolean;         // default: false
  labelFontSize: number;          // default: 11 (px, range 8-16)
  deadUnitDisplay: 'fade' | 'hide' | 'marker'; // default: 'fade'
  deadOpacity: number;            // default: 0.35 (range 0-1)
  selectionRing: boolean;         // default: true
  defaultFollowZoom: number;      // default: 19 (range 14-22) — NOTE: distinct from director.ts's runtime `followZoom` which is transient state

  // ── Trails & Lines ──
  trailWidth: number;             // default: 2 (px, range 1-6)
  trailOpacity: number;           // default: 0.6 (range 0.1-1)
  trailLength: number;            // default: 100 (positions, range 10-500)
  killLineWidth: number;          // default: 2 (px, range 1-6)
  killLineDuration: number;       // default: 3 (seconds, range 0.5-10)
  killLineStyle: 'solid' | 'dashed' | 'pulse'; // default: 'solid'
  hitLineWidth: number;           // default: 1.5 (px, range 1-6)
  hitLineDuration: number;        // default: 2 (seconds, range 0.5-10)

  // ── Effects ──
  reviveDuration: number;         // default: 1 (seconds, range 0.3-3)
  reviveIntensity: number;        // default: 0.8 (range 0.1-1)
  healDuration: number;           // default: 1.5 (seconds, range 0.3-3)
  healGlowSize: number;           // default: 1.5 (multiplier, range 1-3)
  hitFlashDuration: number;       // default: 0.3 (seconds, range 0.1-1)
  hitFlashIntensity: number;      // default: 0.7 (range 0.1-1)
  deathDuration: number;          // default: 2 (seconds, range 0.5-5)
  deathScale: number;             // default: 1.5 (multiplier, range 0.5-3)
  bombingRadius: boolean;         // default: true
  bombingDuration: number;        // default: 3 (seconds, range 0.5-5)

  // ── Ballistics ──
  sniperTracerEnabled: boolean;   // default: true
  tracerSpeed: number;            // default: 1 (multiplier, range 0.5-5)
  tracerWidth: number;            // default: 2 (px, range 1-6)
  tracerTrailLength: number;      // default: 80 (px, range 10-200)
  tracerGlow: number;             // default: 0.6 (range 0-1)
  tracerDuration: number;         // default: 2 (seconds, range 0.5-5)

  // ── Playback (new additions) ──
  autoPlay: boolean;              // default: true — NOTE: App.tsx auto-play useEffect must read this from store; the existing `autoPlayedRef` guard is preserved to fire only once per game load
  focusLockDuration: number;      // default: 6 (seconds, range 2-15)
}
```

#### Existing Stores (unchanged structure, consumed by Settings Panel)

| Store | Settings consumed |
|-------|------------------|
| `playback.ts` | mapStyle, tiltMode, speed, trailEnabled, killLineEnabled, hitLineEnabled, reviveEffectEnabled, healEffectEnabled, hitFeedbackEnabled, deathEffectEnabled, killstreakSlowDiv, longRangeSlowSpeed, bombardSlowDiv |
| `director.ts` | focusDarkMap |
| `hotspotFilter.ts` | debugOverlay, typeFilters |
| `i18n.ts` | locale |
| `styles.ts` | mapboxToken (via get/set functions) |

### 1.4 Unified Settings API (`/web/src/lib/settingsAPI.ts`)

```typescript
interface FullConfig {
  // All fields from visualConfig
  ...VisualConfig;
  // All persisted fields from playback store
  mapStyle: MapStyleKey;
  tiltMode: boolean;
  speed: number;
  trailEnabled: boolean;
  killLineEnabled: boolean;
  hitLineEnabled: boolean;
  reviveEffectEnabled: boolean;
  healEffectEnabled: boolean;
  hitFeedbackEnabled: boolean;
  deathEffectEnabled: boolean;
  killstreakSlowDiv: number;
  longRangeSlowSpeed: number;
  bombardSlowDiv: number;
  // Director
  focusDarkMap: boolean;
  // i18n
  locale: 'en' | 'zh';
  // Hotspot filter
  debugOverlay: boolean;
  typeFilters: Record<string, boolean>;
  // Mapbox
  mapboxToken: string;
}

function exportConfig(): FullConfig;
function importConfig(json: unknown): { ok: boolean; errors: string[] };
function resetToDefaults(): void;
const DEFAULTS: FullConfig;
```

**Import validation rules:**
- Type check each field (string, number, boolean)
- Range check numeric fields (min/max defined per field)
- Color fields: validate hex format `#rrggbb`
- Unknown fields: silently ignored
- Missing fields: filled from DEFAULTS
- Returns error list for invalid fields (partial import succeeds for valid fields)

**Side effects on import/reset:**
- After applying `mapboxToken`, must call `usePlayback.getState().bumpStyleNonce()` to force map tile reload — otherwise the token change writes to localStorage but the map renders stale tiles.
- After applying `mapStyle`, must call `usePlayback.getState().setMapStyle()` which triggers the style-switch effect in MapView.
- After applying `locale`, must call `useI18n.getState().setLocale()` to trigger UI re-render.

### 1.5 Reusable Control Components (`/web/src/components/settings/controls/`)

| Component | Props | Renders |
|-----------|-------|---------|
| `SettingToggle` | label, value, onChange, disabled?, description? | Label + toggle switch |
| `SettingSlider` | label, value, onChange, min, max, step?, unit?, description? | Label + range slider + numeric value display |
| `SettingSelect` | label, value, onChange, options: {value,label}[], description? | Label + dropdown select |
| `SettingColor` | label, value, onChange, description? | Label + color swatch + `<input type="color">` + hex text |
| `SettingInput` | label, value, onChange, placeholder?, type?, description? | Label + text input |
| `SettingGroup` | title, description?, children | Section header + grouped controls |

All controls: dark theme (zinc-800/900), consistent 2-column layout (label left, control right), optional `description` shown as small muted text below.

### 1.6 Tab Components (`/web/src/components/settings/tabs/`)

Each tab file: `MapTab.tsx`, `ColorsTab.tsx`, `UnitsTab.tsx`, `TrailsTab.tsx`, `EffectsTab.tsx`, `BallisticsTab.tsx`, `PlaybackTab.tsx`, `GeneralTab.tsx`.

Each tab reads from the appropriate store(s) and calls the corresponding setter on change. All changes are instant (no "Apply" button needed).

**GeneralTab** additional features:
- Export button: calls `exportConfig()`, creates Blob, triggers download as `wargame-settings.json`
- Import button: hidden `<input type="file" accept=".json">`, reads file, calls `importConfig()`, shows success/error toast
- JSON editor: collapsible `<textarea>` pre-filled with `JSON.stringify(exportConfig(), null, 2)`, "Apply" button calls `importConfig(JSON.parse(text))`
- Reset button: opens `ConfirmDialog` ("Reset all settings to defaults?"), on confirm calls `resetToDefaults()`

### 1.7 Confirm Dialog Component

`/web/src/components/settings/ConfirmDialog.tsx` — small centered modal:
- Title, message, Confirm (red) + Cancel buttons
- Used by Reset and potentially dangerous Import overwrite

### 1.8 Consumer Integration

Map layer components subscribe to `useVisualConfig` for the new parameters. Pattern:

```typescript
// In UnitLayer.tsx
const { unitIconSize, deadOpacity, redTeamColor, blueTeamColor } = useVisualConfig();
```

**Icon regeneration:** `unitIcons.ts` currently generates canvas icons with hardcoded colors and sizes. Needs refactoring to accept color/size params. When colors/size change, icons must be regenerated. Use `map.hasImage(id) ? map.updateImage(id, newData) : map.addImage(id, newData)` to avoid errors from duplicate IDs. The current `if (!map.hasImage(id))` guard in `registerUnitIcons` must be removed/replaced with this update-or-add pattern. Use a `useEffect` in `UnitLayer.tsx` that watches color/size params and triggers regeneration.

### 1.9 i18n Keys

All new settings need EN + ZH translation keys. Naming convention: `settings_<tab>_<field>` for labels, `settings_<tab>_<field>_desc` for descriptions.

### 1.10 Keyboard Shortcut

- `,` (comma) — toggle Settings Panel open/close
- `Esc` — close Settings Panel (when open)

---

## Part 2: Executable Launcher Optimization

### 2.1 New Package: `server/browser/`

Cross-platform browser detection and launching.

#### `browser/detect.go`

```go
// findChrome returns the Chrome executable path, or "" if not found.
func findChrome() string { ... }

// findEdge returns the Edge executable path, or "" if not found.
func findEdge() string { ... }
```

**Detection paths:**

| OS | Chrome | Edge |
|----|--------|------|
| macOS | `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` | `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` |
| Windows | `%ProgramFiles%\Google\Chrome\Application\chrome.exe`, `%ProgramFiles(x86)%\...`, `%LocalAppData%\Google\Chrome\Application\chrome.exe` | `%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe`, `%ProgramFiles%\...` |
| Linux | `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser` (via exec.LookPath) | `microsoft-edge`, `microsoft-edge-stable` (via exec.LookPath) |

#### `browser/open.go`

```go
// Open launches the URL in the best available browser.
// Priority: Chrome --app → Edge --app → default browser.
func Open(url string) error { ... }
```

**`--app` mode flags:** `--app=<url> --new-window --disable-extensions --window-size=1280,800`

**Default browser fallback** (platform-specific):
- macOS: `exec.Command("open", url)`
- Windows: `exec.Command("cmd", "/c", "start", url)`
- Linux: `exec.Command("xdg-open", url)`

#### `browser/open_<os>.go`

Build-tagged files for platform-specific `openDefault()` implementations.

### 2.2 main.go Changes

New CLI flags:
```go
openBrowser := flag.Bool("open", true, "auto-open browser on startup")
appMode     := flag.Bool("app", true, "prefer Chrome/Edge --app mode (no URL bar)")
```

After Gin server starts listening:
```go
go func() {
    // Poll /api/health up to 30 times (0.5s intervals, 15s max)
    for i := 0; i < 30; i++ {
        resp, err := http.Get("http://" + addr + "/api/health")
        if err == nil && resp.StatusCode == 200 {
            resp.Body.Close()
            if *openBrowser {
                if *appMode {
                    browser.Open("http://" + addr)
                } else {
                    browser.OpenDefault("http://" + addr)
                }
            }
            return
        }
        time.Sleep(500 * time.Millisecond)
    }
}()
```

### 2.3 Windows: Hide Console Window

In `.github/workflows/release.yml`, Windows build step:
```bash
CGO_ENABLED=1 go build -ldflags="-H windowsgui -X main.version=$VERSION" -o ...
```

`-H windowsgui` links the binary as a Windows GUI application — no console window appears on double-click.

**Important:** `-H windowsgui` suppresses stdout/stderr entirely (even when launched from terminal), making startup failures undebuggable. Mitigations required:

1. Add a `_windows.go` init file that calls `windows.AttachConsole(ATTACH_PARENT_PROCESS)` — this restores stdio when launched from an existing terminal (e.g., PowerShell), while double-click still has no console.
2. Add file-based log fallback: on Windows, if `AttachConsole` fails (double-click case), redirect `log` output to `%LOCALAPPDATA%\MilSimReplay\server.log` so users can inspect failures.
3. Log the file path on startup: `log.Printf("Logs written to %s", logPath)` (visible only in terminal case).

### 2.4 macOS: Simplify launcher.sh

Current launcher.sh has its own health-check + `open` logic. Since the Go binary now handles browser opening via `-open` flag, simplify to:

```bash
#!/bin/bash
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$SELF_DIR/../Resources/wargame-replay"
DATA_DIR="${HOME}/MilSimReplay"
mkdir -p "$DATA_DIR"
exec "$BINARY" -dir "$DATA_DIR" -open
```

The binary's internal goroutine handles the health check + browser launch, including `--app` mode detection.

### 2.5 Linux

No special launcher needed. Users run from terminal:
```bash
./wargame-replay -dir ./data
```
Browser auto-opens via `xdg-open` or Chrome `--app` if available.

---

## File Inventory

### New Files

| Path | Purpose |
|------|---------|
| `web/src/store/visualConfig.ts` | New Zustand store for ~45 visual parameters |
| `web/src/lib/settingsAPI.ts` | Export/import/reset/defaults aggregation layer |
| `web/src/components/settings/SettingsPanel.tsx` | Main settings modal with tab navigation |
| `web/src/components/settings/tabs/MapTab.tsx` | Map settings tab |
| `web/src/components/settings/tabs/ColorsTab.tsx` | Color settings tab |
| `web/src/components/settings/tabs/UnitsTab.tsx` | Unit display settings tab |
| `web/src/components/settings/tabs/TrailsTab.tsx` | Trails & lines settings tab |
| `web/src/components/settings/tabs/EffectsTab.tsx` | Visual effects settings tab |
| `web/src/components/settings/tabs/BallisticsTab.tsx` | Ballistics/tracer settings tab |
| `web/src/components/settings/tabs/PlaybackTab.tsx` | Playback speed & slowdown settings tab |
| `web/src/components/settings/tabs/GeneralTab.tsx` | Language, debug, import/export/reset/JSON |
| `web/src/components/settings/controls/SettingToggle.tsx` | Reusable toggle control |
| `web/src/components/settings/controls/SettingSlider.tsx` | Reusable slider control |
| `web/src/components/settings/controls/SettingSelect.tsx` | Reusable dropdown control |
| `web/src/components/settings/controls/SettingColor.tsx` | Reusable color picker control |
| `web/src/components/settings/controls/SettingInput.tsx` | Reusable text input control |
| `web/src/components/settings/controls/SettingGroup.tsx` | Section grouping component |
| `web/src/components/settings/ConfirmDialog.tsx` | Confirmation dialog for reset |
| `server/browser/open.go` | Cross-platform browser opener (shared logic) |
| `server/browser/detect.go` | Chrome/Edge detection logic |
| `server/browser/open_darwin.go` | macOS default browser fallback |
| `server/browser/open_windows.go` | Windows default browser fallback |
| `server/browser/open_linux.go` | Linux default browser fallback |
| `server/winlog_windows.go` | Windows: AttachConsole + file-based log fallback |

### Modified Files

| Path | Changes |
|------|---------|
| `web/src/components/TopBar.tsx` | Add gear button (calls `onShowSettings` prop), remove local settings state |
| `web/src/App.tsx` | Add `showSettings` state, `,` keyboard shortcut, pass `onShowSettings` to TopBar, render SettingsPanel; update auto-play effect to check `autoPlay` from visualConfig store |
| `web/src/components/ShortcutHelp.tsx` | Add `,` shortcut entry |
| `web/src/lib/i18n.ts` | Add ~80 new translation keys (EN + ZH) |
| `web/src/map/MapView.tsx` | Read visualConfig for intro params, globe toggle |
| `web/src/map/UnitLayer.tsx` | Read visualConfig for icon size, colors, dead display |
| `web/src/map/TrailLayer.tsx` | Read visualConfig for trail width/opacity/length, line params |
| `web/src/map/SniperTracerLayer.tsx` | Read visualConfig for tracer speed/width/glow/duration |
| `web/src/map/BombingLayer.tsx` | Read visualConfig for bombing duration/radius/color |
| `web/src/map/unitIcons.ts` | Accept color/size params, regenerate on change |
| `web/src/map/HotspotLayer.tsx` | Read visualConfig for hotspot circle color |
| `web/src/map/HotspotActivityCircle.tsx` | Read visualConfig for hotspot circle color |
| `web/src/store/playback.ts` | No new fields (autoPlay lives in visualConfig store) |
| `web/src/components/Settings.tsx` | Remove (absorbed into SettingsPanel MapTab) |
| `server/main.go` | Add -open/-app flags, browser launch goroutine |
| `assets/macos/launcher.sh` | Simplify to delegate browser-open to binary |
| `.github/workflows/release.yml` | Add -H windowsgui for Windows builds |

---

## Non-Goals

- Baidu maps (BD-09 coordinate system incompatible)
- Electron/Tauri native wrapper (too much build complexity)
- Per-game settings profiles (single global config for now)
- Server-side settings storage (all client-side localStorage)
