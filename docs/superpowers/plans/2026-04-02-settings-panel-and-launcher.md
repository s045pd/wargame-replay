# Settings Panel & Launcher Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a comprehensive settings panel (8 tabs, ~70 params, import/export/reset/JSON) and optimize the executable to auto-open a kiosk-style browser window.

**Architecture:** New `useVisualConfig` Zustand store holds ~45 new visual parameters alongside existing stores. A `settingsAPI.ts` layer aggregates all stores for export/import/reset. Reusable control components render each tab. Go `server/browser/` package handles cross-platform Chrome `--app` mode detection.

**Tech Stack:** React 18 + Zustand + TypeScript (strict), MapLibre GL JS, Go 1.22 + Gin, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-02-settings-panel-and-launcher-design.md`

---

## File Structure

### New Files — Frontend

| File | Responsibility |
|------|---------------|
| `web/src/store/visualConfig.ts` | Zustand store: ~45 visual params with defaults, localStorage persistence |
| `web/src/lib/settingsAPI.ts` | Export/import/reset across all stores, validation, DEFAULTS constant |
| `web/src/components/settings/SettingsPanel.tsx` | Full-screen modal shell with left-sidebar tab navigation |
| `web/src/components/settings/ConfirmDialog.tsx` | Reusable confirm modal (title, message, confirm/cancel) |
| `web/src/components/settings/controls/SettingToggle.tsx` | Label + toggle switch |
| `web/src/components/settings/controls/SettingSlider.tsx` | Label + range slider + value display |
| `web/src/components/settings/controls/SettingSelect.tsx` | Label + dropdown |
| `web/src/components/settings/controls/SettingColor.tsx` | Label + color swatch + hex input |
| `web/src/components/settings/controls/SettingInput.tsx` | Label + text input |
| `web/src/components/settings/controls/SettingGroup.tsx` | Section header with optional description |
| `web/src/components/settings/tabs/MapTab.tsx` | Map source, tilt, globe, intro animation, Mapbox token |
| `web/src/components/settings/tabs/ColorsTab.tsx` | All color pickers (team, trail, line, effect) |
| `web/src/components/settings/tabs/UnitsTab.tsx` | Icon size, labels, dead display, follow zoom |
| `web/src/components/settings/tabs/TrailsTab.tsx` | Trail/kill-line/hit-line width/opacity/duration/style |
| `web/src/components/settings/tabs/EffectsTab.tsx` | Revive/heal/hit/death effect duration/intensity/scale |
| `web/src/components/settings/tabs/BallisticsTab.tsx` | Sniper tracer speed/width/glow/duration |
| `web/src/components/settings/tabs/PlaybackTab.tsx` | Speed, slowdowns, focusDarkMap, autoPlay |
| `web/src/components/settings/tabs/GeneralTab.tsx` | Language, debug, filters, export/import/reset/JSON |

### New Files — Backend

| File | Responsibility |
|------|---------------|
| `server/browser/open.go` | `Open(url)` — tries Chrome/Edge `--app`, falls back to default |
| `server/browser/detect.go` | `findChrome()`, `findEdge()` — cross-platform path detection |
| `server/browser/open_darwin.go` | `openDefault(url)` via `open` command |
| `server/browser/open_windows.go` | `openDefault(url)` via `cmd /c start` |
| `server/browser/open_linux.go` | `openDefault(url)` via `xdg-open` |
| `server/winlog_windows.go` | `init()`: AttachConsole + file-based log fallback |

### Modified Files

| File | Changes |
|------|---------|
| `web/src/App.tsx` | Add `showSettings` state, `,` shortcut, render SettingsPanel, update autoPlay effect |
| `web/src/components/TopBar.tsx` | Add gear button calling `onShowSettings` prop |
| `web/src/components/ShortcutHelp.tsx` | Add `,` shortcut entry |
| `web/src/lib/i18n.ts` | ~80 new EN+ZH keys |
| `web/src/map/MapView.tsx` | Read visualConfig for intro params, globe toggle |
| `web/src/map/unitIcons.ts` | Accept colors/size params, use updateImage pattern |
| `web/src/map/UnitLayer.tsx` | Read visualConfig for colors, sizes, dead display, effects |
| `web/src/map/TrailLayer.tsx` | Read visualConfig for widths, opacities, durations, colors |
| `web/src/map/SniperTracerLayer.tsx` | Read visualConfig for tracer params |
| `web/src/map/BombingLayer.tsx` | Read visualConfig for bombing params |
| `web/src/map/HotspotLayer.tsx` | Read visualConfig for hotspot circle color |
| `web/src/map/HotspotActivityCircle.tsx` | Read visualConfig for hotspot circle color |
| `web/src/components/Settings.tsx` | Delete (absorbed into MapTab) |
| `server/main.go` | Add `-open`/`-app` flags, browser launch goroutine |
| `assets/macos/launcher.sh` | Simplify to pass `-open` to binary |
| `.github/workflows/release.yml` | Add `-H windowsgui` for Windows |

---

## Phase 1: Foundation

### Task 1: Create `useVisualConfig` Zustand Store

**Files:**
- Create: `web/src/store/visualConfig.ts`

- [ ] **Step 1: Create store with all defaults and persistence**

```typescript
// web/src/store/visualConfig.ts
import { create } from 'zustand';

const LS_KEY = 'wargame-visual';

// ── Default values (extracted from hardcoded constants across map layers) ──
export const VISUAL_DEFAULTS = {
  // Map
  globeProjection: true,
  introAnimation: true,
  introDuration: 3.5,
  introPitch: 50,
  introBearing: -15,
  maxZoom: 18,
  boundsPadding: 15,

  // Colors — match current hardcoded values in map layers (unitIcons.ts, UnitLayer.tsx, TrailLayer.tsx)
  // NOTE: spec listed slightly different aspirational defaults; these match the ACTUAL codebase values
  // to ensure resetToDefaults() restores the look users are accustomed to.
  redTeamColor: '#e03030',
  redDeadColor: '#662222',
  blueTeamColor: '#1890ff',
  blueDeadColor: '#223366',
  killLineColor: '#ff3333',
  hitLineColor: '#ffcc00',
  redTrailColor: '#ff4444',
  blueTrailColor: '#00ccff',
  sniperTracerColor: '#00ccff',
  bombingColor: '#ff3c14',
  selectionColor: '#ffffff',
  hotspotCircleColor: '#ffa000',

  // Units — from unitIcons.ts, UnitLayer.tsx
  unitIconSize: 28,
  showUnitLabel: false,
  labelFontSize: 11,
  deadUnitDisplay: 'fade' as const,
  deadOpacity: 0.5,
  selectionRing: true,
  defaultFollowZoom: 19,

  // Trails & Lines — from TrailLayer.tsx
  trailWidth: 2,
  trailOpacity: 0.6,
  trailLength: 100,
  killLineWidth: 4,
  killLineDuration: 3,
  killLineStyle: 'solid' as const,
  hitLineWidth: 2.5,
  hitLineDuration: 2,

  // Effects — from UnitLayer.tsx
  reviveDuration: 1.1,
  reviveIntensity: 0.8,
  healDuration: 1.5,
  healGlowSize: 1.5,
  hitFlashDuration: 0.4,
  hitFlashIntensity: 0.7,
  deathDuration: 1.1,
  deathScale: 1.5,
  bombingRadius: true,
  bombingDuration: 2.5,

  // Ballistics — from SniperTracerLayer.tsx
  sniperTracerEnabled: true,
  tracerSpeed: 1,
  tracerWidth: 2,
  tracerTrailLength: 80,
  tracerGlow: 0.6,
  tracerDuration: 1.1,

  // Playback additions
  autoPlay: true,
  focusLockDuration: 6,
} as const;

export type VisualConfig = {
  -readonly [K in keyof typeof VISUAL_DEFAULTS]: (typeof VISUAL_DEFAULTS)[K];
};

type VisualConfigStore = VisualConfig & {
  set: <K extends keyof VisualConfig>(key: K, value: VisualConfig[K]) => void;
  setBatch: (partial: Partial<VisualConfig>) => void;
  reset: () => void;
};

function loadVisualPrefs(): Partial<VisualConfig> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveVisualPrefs(state: VisualConfig) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

const _stored = loadVisualPrefs();

export const useVisualConfig = create<VisualConfigStore>((set, get) => ({
  ...VISUAL_DEFAULTS,
  ..._stored,

  set: (key, value) => {
    set({ [key]: value } as Partial<VisualConfig>);
    saveVisualPrefs({ ...get(), [key]: value });
  },

  setBatch: (partial) => {
    set(partial);
    saveVisualPrefs({ ...get(), ...partial });
  },

  reset: () => {
    const defaults = { ...VISUAL_DEFAULTS };
    set(defaults);
    saveVisualPrefs(defaults);
  },
}));
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/s045pd/workobj/BackupData/DocumentArchive/GitHub/WarGame/wargame-replay/web && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/store/visualConfig.ts
git commit -m "feat: add useVisualConfig store with ~45 visual parameters and persistence"
```

---

### Task 2: Create Settings API (`settingsAPI.ts`)

**Files:**
- Create: `web/src/lib/settingsAPI.ts`

- [ ] **Step 1: Create the aggregation/validation layer**

```typescript
// web/src/lib/settingsAPI.ts
import { useVisualConfig, VISUAL_DEFAULTS, VisualConfig } from '../store/visualConfig';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useHotspotFilter } from '../store/hotspotFilter';
import { useI18n, Locale } from './i18n';
import { getMapboxToken, setMapboxToken, resetMapboxToken } from '../map/styles';
import { DEFAULT_STYLE } from '../map/styles';
import type { MapStyleKey } from '../map/styles';

// ── Full config shape (all stores combined) ──

export interface FullConfig extends VisualConfig {
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
  focusDarkMap: boolean;
  locale: Locale;
  debugOverlay: boolean;
  typeFilters: Record<string, boolean>;
  mapboxToken: string;
}

export const DEFAULTS: FullConfig = {
  ...VISUAL_DEFAULTS,
  mapStyle: DEFAULT_STYLE,
  tiltMode: false,
  speed: 64,
  trailEnabled: true,
  killLineEnabled: true,
  hitLineEnabled: true,
  reviveEffectEnabled: true,
  healEffectEnabled: true,
  hitFeedbackEnabled: true,
  deathEffectEnabled: true,
  killstreakSlowDiv: 8,
  longRangeSlowSpeed: 1,
  bombardSlowDiv: 4,
  focusDarkMap: true,
  locale: 'zh',
  debugOverlay: false,
  typeFilters: {
    firefight: true,
    killstreak: true,
    mass_casualty: true,
    engagement: true,
    bombardment: true,
    long_range: true,
  },
  mapboxToken: '',
};

// ── Validation ranges for numeric fields ──

const RANGES: Partial<Record<keyof FullConfig, [number, number]>> = {
  introDuration: [1, 8],
  introPitch: [0, 60],
  introBearing: [-180, 180],
  maxZoom: [10, 22],
  boundsPadding: [5, 30],
  unitIconSize: [16, 64],
  labelFontSize: [8, 16],
  deadOpacity: [0, 1],
  defaultFollowZoom: [14, 22],
  trailWidth: [1, 6],
  trailOpacity: [0.1, 1],
  trailLength: [10, 500],
  killLineWidth: [1, 6],
  killLineDuration: [0.5, 10],
  hitLineWidth: [1, 6],
  hitLineDuration: [0.5, 10],
  reviveDuration: [0.3, 3],
  reviveIntensity: [0.1, 1],
  healDuration: [0.3, 3],
  healGlowSize: [1, 3],
  hitFlashDuration: [0.1, 1],
  hitFlashIntensity: [0.1, 1],
  deathDuration: [0.5, 5],
  deathScale: [0.5, 3],
  bombingDuration: [0.5, 5],
  tracerSpeed: [0.5, 5],
  tracerWidth: [1, 6],
  tracerTrailLength: [10, 200],
  tracerGlow: [0, 1],
  tracerDuration: [0.5, 5],
  focusLockDuration: [2, 15],
  speed: [1, 128],
  killstreakSlowDiv: [0, 16],
  longRangeSlowSpeed: [0, 8],
  bombardSlowDiv: [0, 8],
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ── Export: aggregate all stores into one JSON ──

export function exportConfig(): FullConfig {
  const vc = useVisualConfig.getState();
  const pb = usePlayback.getState();
  const dir = useDirector.getState();
  const hf = useHotspotFilter.getState();
  const i18n = useI18n.getState();

  // Extract only VisualConfig fields (not store methods)
  const visualFields: Record<string, unknown> = {};
  for (const key of Object.keys(VISUAL_DEFAULTS)) {
    visualFields[key] = vc[key as keyof VisualConfig];
  }

  return {
    ...(visualFields as VisualConfig),
    mapStyle: pb.mapStyle,
    tiltMode: pb.tiltMode,
    speed: pb.speed,
    trailEnabled: pb.trailEnabled,
    killLineEnabled: pb.killLineEnabled,
    hitLineEnabled: pb.hitLineEnabled,
    reviveEffectEnabled: pb.reviveEffectEnabled,
    healEffectEnabled: pb.healEffectEnabled,
    hitFeedbackEnabled: pb.hitFeedbackEnabled,
    deathEffectEnabled: pb.deathEffectEnabled,
    killstreakSlowDiv: pb.killstreakSlowDiv,
    longRangeSlowSpeed: pb.longRangeSlowSpeed,
    bombardSlowDiv: pb.bombardSlowDiv,
    focusDarkMap: dir.focusDarkMap,
    locale: i18n.locale,
    debugOverlay: hf.debugOverlay,
    typeFilters: { ...hf.typeFilters },
    mapboxToken: getMapboxToken(),
  };
}

// ── Import: validate + distribute to stores ──

export function importConfig(json: unknown): { ok: boolean; errors: string[] } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, errors: ['Invalid config: expected a JSON object'] };
  }

  const obj = json as Record<string, unknown>;
  const errors: string[] = [];
  const visualPatch: Partial<VisualConfig> = {};

  // Validate and collect visual config fields
  for (const [key, defaultVal] of Object.entries(VISUAL_DEFAULTS)) {
    if (!(key in obj)) continue;
    const val = obj[key];
    const expectedType = typeof defaultVal;

    if (typeof val !== expectedType) {
      errors.push(`${key}: expected ${expectedType}, got ${typeof val}`);
      continue;
    }

    // Range check
    const range = RANGES[key as keyof FullConfig];
    if (range && typeof val === 'number') {
      if (val < range[0] || val > range[1]) {
        errors.push(`${key}: ${val} out of range [${range[0]}, ${range[1]}]`);
        continue;
      }
    }

    // Color check
    if (typeof val === 'string' && typeof defaultVal === 'string' && defaultVal.startsWith('#')) {
      if (!HEX_COLOR_RE.test(val)) {
        errors.push(`${key}: invalid hex color "${val}"`);
        continue;
      }
    }

    (visualPatch as Record<string, unknown>)[key] = val;
  }

  // Apply visual config
  if (Object.keys(visualPatch).length > 0) {
    useVisualConfig.getState().setBatch(visualPatch);
  }

  // Apply playback store fields
  const pb = usePlayback.getState();
  if (obj.mapStyle !== undefined && typeof obj.mapStyle === 'string') {
    pb.setMapStyle(obj.mapStyle as MapStyleKey);
  }
  if (typeof obj.tiltMode === 'boolean' && pb.tiltMode !== obj.tiltMode) pb.toggleTiltMode();
  if (typeof obj.speed === 'number') pb.setSpeed(obj.speed);
  if (typeof obj.trailEnabled === 'boolean') pb.setTrailEnabled(obj.trailEnabled);
  if (typeof obj.killLineEnabled === 'boolean') pb.setKillLineEnabled(obj.killLineEnabled);
  if (typeof obj.hitLineEnabled === 'boolean') pb.setHitLineEnabled(obj.hitLineEnabled);
  if (typeof obj.reviveEffectEnabled === 'boolean') pb.setReviveEffectEnabled(obj.reviveEffectEnabled);
  if (typeof obj.healEffectEnabled === 'boolean') pb.setHealEffectEnabled(obj.healEffectEnabled);
  if (typeof obj.hitFeedbackEnabled === 'boolean') pb.setHitFeedbackEnabled(obj.hitFeedbackEnabled);
  if (typeof obj.deathEffectEnabled === 'boolean') pb.setDeathEffectEnabled(obj.deathEffectEnabled);
  if (typeof obj.killstreakSlowDiv === 'number') pb.setKillstreakSlowDiv(obj.killstreakSlowDiv);
  if (typeof obj.longRangeSlowSpeed === 'number') pb.setLongRangeSlowSpeed(obj.longRangeSlowSpeed);
  if (typeof obj.bombardSlowDiv === 'number') pb.setBombardSlowDiv(obj.bombardSlowDiv);

  // Apply director
  if (typeof obj.focusDarkMap === 'boolean') {
    const dir = useDirector.getState();
    if (dir.focusDarkMap !== obj.focusDarkMap) dir.toggleFocusDarkMap();
  }

  // Apply locale
  if (obj.locale === 'en' || obj.locale === 'zh') {
    useI18n.getState().setLocale(obj.locale);
  }

  // Apply hotspot filter
  if (typeof obj.debugOverlay === 'boolean') {
    const hf = useHotspotFilter.getState();
    if (hf.debugOverlay !== obj.debugOverlay) hf.toggleDebugOverlay();
  }
  if (typeof obj.typeFilters === 'object' && obj.typeFilters !== null) {
    const hf = useHotspotFilter.getState();
    const tf = obj.typeFilters as Record<string, boolean>;
    for (const [k, v] of Object.entries(tf)) {
      if (typeof v === 'boolean' && k in hf.typeFilters) {
        hf.setTypeFilter(k, v);
      }
    }
  }

  // Apply mapbox token (with side-effect)
  if (typeof obj.mapboxToken === 'string') {
    setMapboxToken(obj.mapboxToken);
    usePlayback.getState().bumpStyleNonce();
  }

  return { ok: errors.length === 0, errors };
}

// ── Reset all stores to defaults ──

export function resetToDefaults(): void {
  // Visual config
  useVisualConfig.getState().reset();

  // Playback store
  const pb = usePlayback.getState();
  pb.setMapStyle(DEFAULTS.mapStyle);
  if (pb.tiltMode !== DEFAULTS.tiltMode) pb.toggleTiltMode();
  pb.setSpeed(DEFAULTS.speed);
  pb.setTrailEnabled(DEFAULTS.trailEnabled);
  pb.setKillLineEnabled(DEFAULTS.killLineEnabled);
  pb.setHitLineEnabled(DEFAULTS.hitLineEnabled);
  pb.setReviveEffectEnabled(DEFAULTS.reviveEffectEnabled);
  pb.setHealEffectEnabled(DEFAULTS.healEffectEnabled);
  pb.setHitFeedbackEnabled(DEFAULTS.hitFeedbackEnabled);
  pb.setDeathEffectEnabled(DEFAULTS.deathEffectEnabled);
  pb.setKillstreakSlowDiv(DEFAULTS.killstreakSlowDiv);
  pb.setLongRangeSlowSpeed(DEFAULTS.longRangeSlowSpeed);
  pb.setBombardSlowDiv(DEFAULTS.bombardSlowDiv);

  // Director
  const dir = useDirector.getState();
  if (dir.focusDarkMap !== DEFAULTS.focusDarkMap) dir.toggleFocusDarkMap();

  // Locale
  useI18n.getState().setLocale(DEFAULTS.locale);

  // Hotspot filter
  const hf = useHotspotFilter.getState();
  if (hf.debugOverlay !== DEFAULTS.debugOverlay) hf.toggleDebugOverlay();
  for (const [k, v] of Object.entries(DEFAULTS.typeFilters)) {
    hf.setTypeFilter(k, v);
  }

  // Mapbox token
  resetMapboxToken();
  pb.bumpStyleNonce();
}
```

**Note:** The `setTypeFilter` method may not exist on `hotspotFilter.ts` yet. If missing, add it in a sub-step: a simple setter `setTypeFilter: (type: string, enabled: boolean) => set(s => ({ typeFilters: { ...s.typeFilters, [type]: enabled } }))`.

- [ ] **Step 2: Add `setTypeFilter` to hotspotFilter store if missing**

Check `web/src/store/hotspotFilter.ts` — if it only has `toggleTypeFilter`, add:
```typescript
setTypeFilter: (type: string, enabled: boolean) =>
  set((s) => ({ typeFilters: { ...s.typeFilters, [type]: enabled } })),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/settingsAPI.ts web/src/store/hotspotFilter.ts
git commit -m "feat: add settingsAPI with export/import/reset and validation"
```

---

### Task 3: Create Reusable Control Components

**Files:**
- Create: `web/src/components/settings/controls/SettingToggle.tsx`
- Create: `web/src/components/settings/controls/SettingSlider.tsx`
- Create: `web/src/components/settings/controls/SettingSelect.tsx`
- Create: `web/src/components/settings/controls/SettingColor.tsx`
- Create: `web/src/components/settings/controls/SettingInput.tsx`
- Create: `web/src/components/settings/controls/SettingGroup.tsx`

- [ ] **Step 1: Create SettingToggle**

```typescript
// web/src/components/settings/controls/SettingToggle.tsx
interface SettingToggleProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  description?: string;
}

export function SettingToggle({ label, value, onChange, disabled, description }: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${disabled ? 'text-zinc-600' : 'text-zinc-300'}`}>{label}</div>
        {description && <div className="text-[10px] text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          value ? 'bg-emerald-600' : 'bg-zinc-700'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create SettingSlider**

```typescript
// web/src/components/settings/controls/SettingSlider.tsx
interface SettingSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  description?: string;
}

export function SettingSlider({ label, value, onChange, min, max, step = 1, unit, description }: SettingSliderProps) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-zinc-300">{label}</div>
        <div className="text-xs text-zinc-400 font-mono">
          {step < 1 ? value.toFixed(1) : value}{unit && <span className="text-zinc-600 ml-0.5">{unit}</span>}
        </div>
      </div>
      {description && <div className="text-[10px] text-zinc-500 mb-1">{description}</div>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
      />
    </div>
  );
}
```

- [ ] **Step 3: Create SettingSelect**

```typescript
// web/src/components/settings/controls/SettingSelect.tsx
interface SettingSelectProps {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  options: { value: string | number; label: string }[];
  description?: string;
}

export function SettingSelect({ label, value, onChange, options, description }: SettingSelectProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-300">{label}</div>
        {description && <div className="text-[10px] text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-600"
      >
        {options.map((opt) => (
          <option key={String(opt.value)} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Create SettingColor**

```typescript
// web/src/components/settings/controls/SettingColor.tsx
interface SettingColorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}

export function SettingColor({ label, value, onChange, description }: SettingColorProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-300">{label}</div>
        {description && <div className="text-[10px] text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 font-mono">{value}</span>
        <label className="relative w-7 h-7 rounded border border-zinc-600 cursor-pointer overflow-hidden" style={{ backgroundColor: value }}>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create SettingInput**

```typescript
// web/src/components/settings/controls/SettingInput.tsx
interface SettingInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  description?: string;
}

export function SettingInput({ label, value, onChange, placeholder, type = 'text', description }: SettingInputProps) {
  return (
    <div className="py-2">
      <div className="text-xs text-zinc-300 mb-1">{label}</div>
      {description && <div className="text-[10px] text-zinc-500 mb-1">{description}</div>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-600"
      />
    </div>
  );
}
```

- [ ] **Step 6: Create SettingGroup**

```typescript
// web/src/components/settings/controls/SettingGroup.tsx
import type { ReactNode } from 'react';

interface SettingGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingGroup({ title, description, children }: SettingGroupProps) {
  return (
    <div className="mb-6">
      <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{title}</h3>
      {description && <p className="text-[10px] text-zinc-600 mb-2">{description}</p>}
      <div className="border-t border-zinc-800 pt-1">{children}</div>
    </div>
  );
}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd web && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add web/src/components/settings/controls/
git commit -m "feat: add reusable settings control components (toggle, slider, select, color, input, group)"
```

---

### Task 4: Create SettingsPanel Shell + ConfirmDialog

**Files:**
- Create: `web/src/components/settings/SettingsPanel.tsx`
- Create: `web/src/components/settings/ConfirmDialog.tsx`

- [ ] **Step 1: Create ConfirmDialog**

```typescript
// web/src/components/settings/ConfirmDialog.tsx
interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-5 w-80" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-zinc-100 mb-2">{title}</h3>
        <p className="text-xs text-zinc-400 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className="px-3 py-1 text-xs rounded bg-red-700 hover:bg-red-600 text-white transition-colors">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create SettingsPanel shell with tab navigation**

This is the main modal. Initially renders a placeholder for each tab content — tabs will be wired in subsequent tasks.

```typescript
// web/src/components/settings/SettingsPanel.tsx
import { useState } from 'react';
import { useI18n } from '../../lib/i18n';

interface SettingsPanelProps {
  onClose: () => void;
}

const TABS = [
  { key: 'map',        icon: '🗺️' },
  { key: 'colors',     icon: '🎨' },
  { key: 'units',      icon: '👤' },
  { key: 'trails',     icon: '〰️' },
  { key: 'effects',    icon: '✨' },
  { key: 'ballistics', icon: '🔫' },
  { key: 'playback',   icon: '⏱️' },
  { key: 'general',    icon: '⚙️' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('map');
  const { t } = useI18n();

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[720px] max-w-[90vw] h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700 shrink-0">
          <h2 className="text-sm font-bold text-zinc-100 tracking-wider">{t('settings')}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 text-lg leading-none">×</button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar tabs */}
          <div className="w-36 border-r border-zinc-800 py-2 shrink-0 overflow-y-auto">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 transition-colors ${
                  activeTab === tab.key
                    ? 'bg-zinc-800 text-zinc-100 border-l-2 border-emerald-500'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-l-2 border-transparent'
                }`}
              >
                <span className="text-sm">{tab.icon}</span>
                {t(`settings_tab_${tab.key}`)}
              </button>
            ))}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* Tab content rendered here — placeholder for now */}
            <div className="text-xs text-zinc-500">Tab: {activeTab}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc -b --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/components/settings/SettingsPanel.tsx web/src/components/settings/ConfirmDialog.tsx
git commit -m "feat: add SettingsPanel shell with tab navigation and ConfirmDialog"
```

---

## Phase 2: Tab Implementations

### Task 5: Add i18n Keys for All Settings

**Files:**
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 1: Add all ~80 new translation keys**

Add to both `en` and `zh` objects in the `translations` record. Keys follow pattern `settings_tab_*` for tab names, `settings_*` for field labels.

Tab names:
```typescript
// EN
'settings_tab_map': 'Map',
'settings_tab_colors': 'Colors',
'settings_tab_units': 'Units',
'settings_tab_trails': 'Trails',
'settings_tab_effects': 'Effects',
'settings_tab_ballistics': 'Ballistics',
'settings_tab_playback': 'Playback',
'settings_tab_general': 'General',

// ZH
'settings_tab_map': '地图',
'settings_tab_colors': '颜色',
'settings_tab_units': '单位',
'settings_tab_trails': '轨迹',
'settings_tab_effects': '特效',
'settings_tab_ballistics': '弹道',
'settings_tab_playback': '回放',
'settings_tab_general': '通用',
```

Map settings:
```typescript
// EN
'settings_globe_projection': 'Globe Projection',
'settings_intro_animation': 'Intro Animation',
'settings_intro_duration': 'Intro Duration',
'settings_intro_pitch': 'Fly-in Pitch',
'settings_intro_bearing': 'Fly-in Bearing',
'settings_max_zoom': 'Max Zoom',
'settings_bounds_padding': 'Bounds Padding',

// ZH
'settings_globe_projection': '地球投影',
'settings_intro_animation': '开场动画',
'settings_intro_duration': '开场时长',
'settings_intro_pitch': '飞入俯仰角',
'settings_intro_bearing': '飞入偏航角',
'settings_max_zoom': '最大缩放',
'settings_bounds_padding': '边界内边距',
```

Color settings:
```typescript
// EN
'settings_red_team_color': 'Red Team Color',
'settings_red_dead_color': 'Red Team Dead',
'settings_blue_team_color': 'Blue Team Color',
'settings_blue_dead_color': 'Blue Team Dead',
'settings_kill_line_color': 'Kill Line Color',
'settings_hit_line_color': 'Hit Line Color',
'settings_red_trail_color': 'Red Trail Color',
'settings_blue_trail_color': 'Blue Trail Color',
'settings_sniper_tracer_color': 'Sniper Tracer',
'settings_bombing_color': 'Bombing Marker',
'settings_selection_color': 'Selection Highlight',
'settings_hotspot_circle_color': 'Hotspot Circle',

// ZH
'settings_red_team_color': '红方颜色',
'settings_red_dead_color': '红方阵亡',
'settings_blue_team_color': '蓝方颜色',
'settings_blue_dead_color': '蓝方阵亡',
'settings_kill_line_color': '击杀线颜色',
'settings_hit_line_color': '击中线颜色',
'settings_red_trail_color': '红方轨迹',
'settings_blue_trail_color': '蓝方轨迹',
'settings_sniper_tracer_color': '狙击弹道',
'settings_bombing_color': '轰炸标记',
'settings_selection_color': '选中高亮',
'settings_hotspot_circle_color': '热点圈',
```

Unit settings:
```typescript
// EN
'settings_unit_icon_size': 'Icon Size',
'settings_show_unit_label': 'Show Labels',
'settings_label_font_size': 'Label Font Size',
'settings_dead_unit_display': 'Dead Unit Display',
'settings_dead_opacity': 'Dead Opacity',
'settings_selection_ring': 'Selection Ring',
'settings_follow_zoom': 'Follow Zoom Level',
'settings_dead_fade': 'Fade',
'settings_dead_hide': 'Hide',
'settings_dead_marker': 'Marker',

// ZH
'settings_unit_icon_size': '图标大小',
'settings_show_unit_label': '显示名称',
'settings_label_font_size': '名称字号',
'settings_dead_unit_display': '阵亡显示',
'settings_dead_opacity': '阵亡透明度',
'settings_selection_ring': '选中高亮环',
'settings_follow_zoom': '跟随缩放',
'settings_dead_fade': '淡出',
'settings_dead_hide': '隐藏',
'settings_dead_marker': '标记',
```

Trail settings:
```typescript
// EN
'settings_trail_width': 'Trail Width',
'settings_trail_opacity': 'Trail Opacity',
'settings_trail_length': 'Trail Length',
'settings_kill_line_width': 'Kill Line Width',
'settings_kill_line_duration': 'Kill Line Duration',
'settings_kill_line_style': 'Kill Line Style',
'settings_hit_line_width': 'Hit Line Width',
'settings_hit_line_duration': 'Hit Line Duration',
'settings_style_solid': 'Solid',
'settings_style_dashed': 'Dashed',
'settings_style_pulse': 'Pulse',

// ZH
'settings_trail_width': '轨迹宽度',
'settings_trail_opacity': '轨迹透明度',
'settings_trail_length': '轨迹长度',
'settings_kill_line_width': '击杀线宽',
'settings_kill_line_duration': '击杀线时长',
'settings_kill_line_style': '击杀线样式',
'settings_hit_line_width': '击中线宽',
'settings_hit_line_duration': '击中线时长',
'settings_style_solid': '实线',
'settings_style_dashed': '虚线',
'settings_style_pulse': '脉冲',
```

Effect settings:
```typescript
// EN
'settings_revive_duration': 'Revive Duration',
'settings_revive_intensity': 'Revive Intensity',
'settings_heal_duration': 'Heal Duration',
'settings_heal_glow_size': 'Heal Glow Size',
'settings_hit_flash_duration': 'Hit Flash Duration',
'settings_hit_flash_intensity': 'Hit Flash Intensity',
'settings_death_duration': 'Death Duration',
'settings_death_scale': 'Death Scale',
'settings_bombing_radius': 'Show Blast Radius',
'settings_bombing_duration': 'Bombing Duration',

// ZH
'settings_revive_duration': '复活时长',
'settings_revive_intensity': '复活强度',
'settings_heal_duration': '回血时长',
'settings_heal_glow_size': '回血光晕',
'settings_hit_flash_duration': '击中闪烁时长',
'settings_hit_flash_intensity': '击中闪烁强度',
'settings_death_duration': '死亡时长',
'settings_death_scale': '死亡缩放',
'settings_bombing_radius': '显示爆炸半径',
'settings_bombing_duration': '轰炸时长',
```

Ballistics settings:
```typescript
// EN
'settings_sniper_tracer_enabled': 'Sniper Tracer',
'settings_tracer_speed': 'Tracer Speed',
'settings_tracer_width': 'Tracer Width',
'settings_tracer_trail_length': 'Tracer Trail Length',
'settings_tracer_glow': 'Tracer Glow',
'settings_tracer_duration': 'Tracer Duration',

// ZH
'settings_sniper_tracer_enabled': '狙击弹道',
'settings_tracer_speed': '弹道速度',
'settings_tracer_width': '弹道宽度',
'settings_tracer_trail_length': '弹道拖尾',
'settings_tracer_glow': '弹道发光',
'settings_tracer_duration': '弹道时长',
```

Playback settings:
```typescript
// EN
'settings_auto_play': 'Auto Play on Connect',
'settings_focus_lock_duration': 'Focus Lock Duration',

// ZH
'settings_auto_play': '连接后自动播放',
'settings_focus_lock_duration': '专注锁定时长',
```

General settings:
```typescript
// EN
'settings_language': 'Language',
'settings_export': 'Export Config',
'settings_import': 'Import Config',
'settings_edit_json': 'Edit JSON',
'settings_apply_json': 'Apply',
'settings_reset_all': 'Reset All Settings',
'settings_reset_confirm_title': 'Reset Settings?',
'settings_reset_confirm_msg': 'This will restore all settings to their default values. This cannot be undone.',
'settings_import_success': 'Config imported',
'settings_import_error': 'Import errors',
'settings_invalid_json': 'Invalid JSON',
'settings_json_placeholder': 'Paste JSON config here...',
'sk_settings': 'Settings',

// ZH
'settings_language': '语言',
'settings_export': '导出配置',
'settings_import': '导入配置',
'settings_edit_json': '编辑 JSON',
'settings_apply_json': '应用',
'settings_reset_all': '重置所有设置',
'settings_reset_confirm_title': '重置设置？',
'settings_reset_confirm_msg': '这将恢复所有设置为默认值，此操作无法撤销。',
'settings_import_success': '配置已导入',
'settings_import_error': '导入错误',
'settings_invalid_json': '无效的 JSON',
'settings_json_placeholder': '粘贴 JSON 配置...',
'sk_settings': '设置',
```

- [ ] **Step 2: Verify compiles**

Run: `cd web && npx tsc -b --noEmit`

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/i18n.ts
git commit -m "feat: add ~80 i18n keys for settings panel (EN + ZH)"
```

---

### Task 6: Implement MapTab + ColorsTab

**Files:**
- Create: `web/src/components/settings/tabs/MapTab.tsx`
- Create: `web/src/components/settings/tabs/ColorsTab.tsx`

- [ ] **Step 1: Create MapTab**

Reads from `usePlayback` (mapStyle, tiltMode), `useVisualConfig` (globe, intro params, maxZoom, padding), and manages the Mapbox token (via `styles.ts` get/set functions). Absorbs the old `Settings.tsx` Mapbox token UI.

```typescript
// web/src/components/settings/tabs/MapTab.tsx
import { useState } from 'react';
import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { ALL_STYLE_KEYS, MapStyleKey, getMapboxToken, setMapboxToken, resetMapboxToken, hasMapboxToken, isEnvToken } from '../../../map/styles';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingInput } from '../controls/SettingInput';
import { SettingGroup } from '../controls/SettingGroup';

export function MapTab() {
  const { t } = useI18n();
  const { mapStyle, setMapStyle, tiltMode, toggleTiltMode, bumpStyleNonce } = usePlayback();
  const vc = useVisualConfig();

  const [tokenDraft, setTokenDraft] = useState(getMapboxToken());
  const [savedMsg, setSavedMsg] = useState('');

  const saveToken = () => {
    setMapboxToken(tokenDraft);
    bumpStyleNonce();
    setSavedMsg(t('saved'));
    setTimeout(() => setSavedMsg(''), 2000);
  };

  const clearToken = () => {
    setMapboxToken('');
    setTokenDraft('');
    bumpStyleNonce();
  };

  const resetToken = () => {
    resetMapboxToken();
    setTokenDraft(getMapboxToken());
    bumpStyleNonce();
  };

  return (
    <div>
      <SettingGroup title={t('map_source')}>
        <SettingSelect
          label={t('map_source')}
          value={mapStyle}
          onChange={(v) => setMapStyle(v as MapStyleKey)}
          options={ALL_STYLE_KEYS.map((k) => ({ value: k, label: t(`style_${k}`) }))}
        />
        <SettingToggle label={t('tilt_mode')} value={tiltMode} onChange={() => toggleTiltMode()} />
        <SettingToggle label={t('settings_globe_projection')} value={vc.globeProjection} onChange={(v) => vc.set('globeProjection', v)} />
      </SettingGroup>

      <SettingGroup title={t('settings_intro_animation')}>
        <SettingToggle label={t('settings_intro_animation')} value={vc.introAnimation} onChange={(v) => vc.set('introAnimation', v)} />
        <SettingSlider label={t('settings_intro_duration')} value={vc.introDuration} onChange={(v) => vc.set('introDuration', v)} min={1} max={8} step={0.5} unit="s" />
        <SettingSlider label={t('settings_intro_pitch')} value={vc.introPitch} onChange={(v) => vc.set('introPitch', v)} min={0} max={60} unit="°" />
        <SettingSlider label={t('settings_intro_bearing')} value={vc.introBearing} onChange={(v) => vc.set('introBearing', v)} min={-180} max={180} unit="°" />
      </SettingGroup>

      <SettingGroup title={t('settings_max_zoom')}>
        <SettingSlider label={t('settings_max_zoom')} value={vc.maxZoom} onChange={(v) => vc.set('maxZoom', v)} min={10} max={22} />
        <SettingSlider label={t('settings_bounds_padding')} value={vc.boundsPadding} onChange={(v) => vc.set('boundsPadding', v)} min={5} max={30} unit="%" />
      </SettingGroup>

      <SettingGroup title={t('mapbox_token')}>
        <SettingInput
          label={t('mapbox_token')}
          value={tokenDraft}
          onChange={setTokenDraft}
          placeholder="pk.eyJ1Ijo..."
          description={t('mapbox_token_hint')}
        />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={saveToken} className="px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white">{t('save')}</button>
          <button onClick={clearToken} className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300">{t('clear')}</button>
          {isEnvToken() && <button onClick={resetToken} className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300">{t('reset')}</button>}
          {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px]">
          <span className={`w-2 h-2 rounded-full ${hasMapboxToken() ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-zinc-500">{t('tile_provider')}: {hasMapboxToken() ? 'Mapbox' : t('free_tiles')}</span>
        </div>
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 2: Create ColorsTab**

```typescript
// web/src/components/settings/tabs/ColorsTab.tsx
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingColor } from '../controls/SettingColor';
import { SettingGroup } from '../controls/SettingGroup';

export function ColorsTab() {
  const { t } = useI18n();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('settings_tab_units')}>
        <SettingColor label={t('settings_red_team_color')} value={vc.redTeamColor} onChange={(v) => vc.set('redTeamColor', v)} />
        <SettingColor label={t('settings_red_dead_color')} value={vc.redDeadColor} onChange={(v) => vc.set('redDeadColor', v)} />
        <SettingColor label={t('settings_blue_team_color')} value={vc.blueTeamColor} onChange={(v) => vc.set('blueTeamColor', v)} />
        <SettingColor label={t('settings_blue_dead_color')} value={vc.blueDeadColor} onChange={(v) => vc.set('blueDeadColor', v)} />
        <SettingColor label={t('settings_selection_color')} value={vc.selectionColor} onChange={(v) => vc.set('selectionColor', v)} />
      </SettingGroup>

      <SettingGroup title={t('settings_tab_trails')}>
        <SettingColor label={t('settings_red_trail_color')} value={vc.redTrailColor} onChange={(v) => vc.set('redTrailColor', v)} />
        <SettingColor label={t('settings_blue_trail_color')} value={vc.blueTrailColor} onChange={(v) => vc.set('blueTrailColor', v)} />
        <SettingColor label={t('settings_kill_line_color')} value={vc.killLineColor} onChange={(v) => vc.set('killLineColor', v)} />
        <SettingColor label={t('settings_hit_line_color')} value={vc.hitLineColor} onChange={(v) => vc.set('hitLineColor', v)} />
      </SettingGroup>

      <SettingGroup title={t('settings_tab_effects')}>
        <SettingColor label={t('settings_sniper_tracer_color')} value={vc.sniperTracerColor} onChange={(v) => vc.set('sniperTracerColor', v)} />
        <SettingColor label={t('settings_bombing_color')} value={vc.bombingColor} onChange={(v) => vc.set('bombingColor', v)} />
        <SettingColor label={t('settings_hotspot_circle_color')} value={vc.hotspotCircleColor} onChange={(v) => vc.set('hotspotCircleColor', v)} />
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify compiles, commit**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/settings/tabs/MapTab.tsx web/src/components/settings/tabs/ColorsTab.tsx
git commit -m "feat: add MapTab and ColorsTab settings panels"
```

---

### Task 7: Implement UnitsTab + TrailsTab

**Files:**
- Create: `web/src/components/settings/tabs/UnitsTab.tsx`
- Create: `web/src/components/settings/tabs/TrailsTab.tsx`

- [ ] **Step 1: Create UnitsTab**

```typescript
// web/src/components/settings/tabs/UnitsTab.tsx
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';

export function UnitsTab() {
  const { t } = useI18n();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('settings_tab_units')}>
        <SettingSlider label={t('settings_unit_icon_size')} value={vc.unitIconSize} onChange={(v) => vc.set('unitIconSize', v)} min={16} max={64} unit="px" />
        <SettingToggle label={t('settings_show_unit_label')} value={vc.showUnitLabel} onChange={(v) => vc.set('showUnitLabel', v)} />
        <SettingSlider label={t('settings_label_font_size')} value={vc.labelFontSize} onChange={(v) => vc.set('labelFontSize', v)} min={8} max={16} unit="px" />
        <SettingToggle label={t('settings_selection_ring')} value={vc.selectionRing} onChange={(v) => vc.set('selectionRing', v)} />
        <SettingSlider label={t('settings_follow_zoom')} value={vc.defaultFollowZoom} onChange={(v) => vc.set('defaultFollowZoom', v)} min={14} max={22} />
      </SettingGroup>

      <SettingGroup title={t('settings_dead_unit_display')}>
        <SettingSelect
          label={t('settings_dead_unit_display')}
          value={vc.deadUnitDisplay}
          onChange={(v) => vc.set('deadUnitDisplay', v as 'fade' | 'hide' | 'marker')}
          options={[
            { value: 'fade', label: t('settings_dead_fade') },
            { value: 'hide', label: t('settings_dead_hide') },
            { value: 'marker', label: t('settings_dead_marker') },
          ]}
        />
        <SettingSlider label={t('settings_dead_opacity')} value={vc.deadOpacity} onChange={(v) => vc.set('deadOpacity', v)} min={0} max={1} step={0.05} />
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 2: Create TrailsTab**

```typescript
// web/src/components/settings/tabs/TrailsTab.tsx
import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';

export function TrailsTab() {
  const { t } = useI18n();
  const { trailEnabled, setTrailEnabled, killLineEnabled, setKillLineEnabled, hitLineEnabled, setHitLineEnabled } = usePlayback();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('fx_trail')}>
        <SettingToggle label={t('fx_trail')} value={trailEnabled} onChange={setTrailEnabled} />
        <SettingSlider label={t('settings_trail_width')} value={vc.trailWidth} onChange={(v) => vc.set('trailWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_trail_opacity')} value={vc.trailOpacity} onChange={(v) => vc.set('trailOpacity', v)} min={0.1} max={1} step={0.05} />
        <SettingSlider label={t('settings_trail_length')} value={vc.trailLength} onChange={(v) => vc.set('trailLength', v)} min={10} max={500} step={10} />
      </SettingGroup>

      <SettingGroup title={t('fx_kill_line')}>
        <SettingToggle label={t('fx_kill_line')} value={killLineEnabled} onChange={setKillLineEnabled} disabled={!trailEnabled} />
        <SettingSlider label={t('settings_kill_line_width')} value={vc.killLineWidth} onChange={(v) => vc.set('killLineWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_kill_line_duration')} value={vc.killLineDuration} onChange={(v) => vc.set('killLineDuration', v)} min={0.5} max={10} step={0.5} unit="s" />
        <SettingSelect
          label={t('settings_kill_line_style')}
          value={vc.killLineStyle}
          onChange={(v) => vc.set('killLineStyle', v as 'solid' | 'dashed' | 'pulse')}
          options={[
            { value: 'solid', label: t('settings_style_solid') },
            { value: 'dashed', label: t('settings_style_dashed') },
            { value: 'pulse', label: t('settings_style_pulse') },
          ]}
        />
      </SettingGroup>

      <SettingGroup title={t('fx_hit_line')}>
        <SettingToggle label={t('fx_hit_line')} value={hitLineEnabled} onChange={setHitLineEnabled} disabled={!trailEnabled} />
        <SettingSlider label={t('settings_hit_line_width')} value={vc.hitLineWidth} onChange={(v) => vc.set('hitLineWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_hit_line_duration')} value={vc.hitLineDuration} onChange={(v) => vc.set('hitLineDuration', v)} min={0.5} max={10} step={0.5} unit="s" />
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/settings/tabs/UnitsTab.tsx web/src/components/settings/tabs/TrailsTab.tsx
git commit -m "feat: add UnitsTab and TrailsTab settings panels"
```

---

### Task 8: Implement EffectsTab + BallisticsTab

**Files:**
- Create: `web/src/components/settings/tabs/EffectsTab.tsx`
- Create: `web/src/components/settings/tabs/BallisticsTab.tsx`

- [ ] **Step 1: Create EffectsTab**

```typescript
// web/src/components/settings/tabs/EffectsTab.tsx
import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingGroup } from '../controls/SettingGroup';

export function EffectsTab() {
  const { t } = useI18n();
  const pb = usePlayback();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('fx_revive')}>
        <SettingToggle label={t('fx_revive')} value={pb.reviveEffectEnabled} onChange={pb.setReviveEffectEnabled} />
        <SettingSlider label={t('settings_revive_duration')} value={vc.reviveDuration} onChange={(v) => vc.set('reviveDuration', v)} min={0.3} max={3} step={0.1} unit="s" />
        <SettingSlider label={t('settings_revive_intensity')} value={vc.reviveIntensity} onChange={(v) => vc.set('reviveIntensity', v)} min={0.1} max={1} step={0.05} />
      </SettingGroup>

      <SettingGroup title={t('fx_heal')}>
        <SettingToggle label={t('fx_heal')} value={pb.healEffectEnabled} onChange={pb.setHealEffectEnabled} />
        <SettingSlider label={t('settings_heal_duration')} value={vc.healDuration} onChange={(v) => vc.set('healDuration', v)} min={0.3} max={3} step={0.1} unit="s" />
        <SettingSlider label={t('settings_heal_glow_size')} value={vc.healGlowSize} onChange={(v) => vc.set('healGlowSize', v)} min={1} max={3} step={0.1} unit="x" />
      </SettingGroup>

      <SettingGroup title={t('fx_hit_feedback')}>
        <SettingToggle label={t('fx_hit_feedback')} value={pb.hitFeedbackEnabled} onChange={pb.setHitFeedbackEnabled} />
        <SettingSlider label={t('settings_hit_flash_duration')} value={vc.hitFlashDuration} onChange={(v) => vc.set('hitFlashDuration', v)} min={0.1} max={1} step={0.05} unit="s" />
        <SettingSlider label={t('settings_hit_flash_intensity')} value={vc.hitFlashIntensity} onChange={(v) => vc.set('hitFlashIntensity', v)} min={0.1} max={1} step={0.05} />
      </SettingGroup>

      <SettingGroup title={t('fx_death')}>
        <SettingToggle label={t('fx_death')} value={pb.deathEffectEnabled} onChange={pb.setDeathEffectEnabled} />
        <SettingSlider label={t('settings_death_duration')} value={vc.deathDuration} onChange={(v) => vc.set('deathDuration', v)} min={0.5} max={5} step={0.1} unit="s" />
        <SettingSlider label={t('settings_death_scale')} value={vc.deathScale} onChange={(v) => vc.set('deathScale', v)} min={0.5} max={3} step={0.1} unit="x" />
      </SettingGroup>

      <SettingGroup title={t('settings_bombing_radius')}>
        <SettingToggle label={t('settings_bombing_radius')} value={vc.bombingRadius} onChange={(v) => vc.set('bombingRadius', v)} />
        <SettingSlider label={t('settings_bombing_duration')} value={vc.bombingDuration} onChange={(v) => vc.set('bombingDuration', v)} min={0.5} max={5} step={0.1} unit="s" />
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 2: Create BallisticsTab**

```typescript
// web/src/components/settings/tabs/BallisticsTab.tsx
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingGroup } from '../controls/SettingGroup';

export function BallisticsTab() {
  const { t } = useI18n();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('settings_sniper_tracer_enabled')}>
        <SettingToggle label={t('settings_sniper_tracer_enabled')} value={vc.sniperTracerEnabled} onChange={(v) => vc.set('sniperTracerEnabled', v)} />
        <SettingSlider label={t('settings_tracer_speed')} value={vc.tracerSpeed} onChange={(v) => vc.set('tracerSpeed', v)} min={0.5} max={5} step={0.1} unit="x" />
        <SettingSlider label={t('settings_tracer_width')} value={vc.tracerWidth} onChange={(v) => vc.set('tracerWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_tracer_trail_length')} value={vc.tracerTrailLength} onChange={(v) => vc.set('tracerTrailLength', v)} min={10} max={200} step={5} unit="px" />
        <SettingSlider label={t('settings_tracer_glow')} value={vc.tracerGlow} onChange={(v) => vc.set('tracerGlow', v)} min={0} max={1} step={0.05} />
        <SettingSlider label={t('settings_tracer_duration')} value={vc.tracerDuration} onChange={(v) => vc.set('tracerDuration', v)} min={0.5} max={5} step={0.1} unit="s" />
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/settings/tabs/EffectsTab.tsx web/src/components/settings/tabs/BallisticsTab.tsx
git commit -m "feat: add EffectsTab and BallisticsTab settings panels"
```

---

### Task 9: Implement PlaybackTab + GeneralTab

**Files:**
- Create: `web/src/components/settings/tabs/PlaybackTab.tsx`
- Create: `web/src/components/settings/tabs/GeneralTab.tsx`

- [ ] **Step 1: Create PlaybackTab**

```typescript
// web/src/components/settings/tabs/PlaybackTab.tsx
import { usePlayback } from '../../../store/playback';
import { useDirector } from '../../../store/director';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';

const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128];
const SLOW_DIVS = [0, 2, 4, 8, 16];
const SLOW_SPEEDS = [0, 1, 2, 4, 8];
const BOMBARD_DIVS = [0, 2, 4, 8];

export function PlaybackTab() {
  const { t } = useI18n();
  const pb = usePlayback();
  const dir = useDirector();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('speed')}>
        <SettingSelect
          label={t('speed')}
          value={String(pb.speed)}
          onChange={(v) => pb.setSpeed(Number(v))}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
        />
        <SettingToggle label={t('settings_auto_play')} value={vc.autoPlay} onChange={(v) => vc.set('autoPlay', v)} />
      </SettingGroup>

      <SettingGroup title={t('slow_group')} description={t('slow_group_tip')}>
        <SettingSelect
          label={t('slow_killstreak')}
          value={String(pb.killstreakSlowDiv)}
          onChange={(v) => pb.setKillstreakSlowDiv(Number(v))}
          options={SLOW_DIVS.map((d) => ({ value: String(d), label: d === 0 ? t('slow_off') : `÷${d}` }))}
        />
        <SettingSelect
          label={t('slow_longrange')}
          value={String(pb.longRangeSlowSpeed)}
          onChange={(v) => pb.setLongRangeSlowSpeed(Number(v))}
          options={SLOW_SPEEDS.map((s) => ({ value: String(s), label: s === 0 ? t('slow_off') : `${s}x` }))}
        />
        <SettingSelect
          label={t('slow_bombard')}
          value={String(pb.bombardSlowDiv)}
          onChange={(v) => pb.setBombardSlowDiv(Number(v))}
          options={BOMBARD_DIVS.map((d) => ({ value: String(d), label: d === 0 ? t('slow_off') : `÷${d}` }))}
        />
      </SettingGroup>

      <SettingGroup title={t('director')}>
        <SettingToggle label={t('focus_dark_map')} value={dir.focusDarkMap} onChange={() => dir.toggleFocusDarkMap()} />
        <SettingSlider label={t('settings_focus_lock_duration')} value={vc.focusLockDuration} onChange={(v) => vc.set('focusLockDuration', v)} min={2} max={15} unit="s" />
      </SettingGroup>
    </div>
  );
}
```

- [ ] **Step 2: Create GeneralTab**

This tab has the most complex logic — export/import/reset/JSON editor. Follow the spec carefully:

```typescript
// web/src/components/settings/tabs/GeneralTab.tsx
import { useState, useRef } from 'react';
import { useI18n, Locale } from '../../../lib/i18n';
import { useHotspotFilter } from '../../../store/hotspotFilter';
import { exportConfig, importConfig, resetToDefaults } from '../../../lib/settingsAPI';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';
import { ConfirmDialog } from '../ConfirmDialog';

const HOTSPOT_TYPES = ['firefight', 'killstreak', 'mass_casualty', 'engagement', 'bombardment', 'long_range'];

export function GeneralTab() {
  const { t, locale, setLocale } = useI18n();
  const { debugOverlay, toggleDebugOverlay, typeFilters, setTypeFilter } = useHotspotFilter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showReset, setShowReset] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [toast, setToast] = useState('');

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleExport = () => {
    const config = exportConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wargame-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const result = importConfig(json);
      flash(result.ok ? t('settings_import_success') : `${t('settings_import_error')}: ${result.errors.join(', ')}`);
    } catch {
      flash(t('settings_invalid_json'));
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleApplyJson = () => {
    try {
      const json = JSON.parse(jsonText);
      const result = importConfig(json);
      flash(result.ok ? t('settings_import_success') : `${t('settings_import_error')}: ${result.errors.join(', ')}`);
    } catch {
      flash(t('settings_invalid_json'));
    }
  };

  const handleReset = () => {
    resetToDefaults();
    setShowReset(false);
    flash(t('settings_import_success'));
  };

  return (
    <div>
      <SettingGroup title={t('settings_language')}>
        <SettingSelect
          label={t('settings_language')}
          value={locale}
          onChange={(v) => setLocale(v as Locale)}
          options={[{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }]}
        />
        <SettingToggle label={t('debug_overlay')} value={debugOverlay} onChange={() => toggleDebugOverlay()} />
      </SettingGroup>

      <SettingGroup title={t('hotspot_filter')}>
        {HOTSPOT_TYPES.map((type) => (
          <SettingToggle
            key={type}
            label={t(type)}
            value={typeFilters[type as keyof typeof typeFilters]}
            onChange={(v) => setTypeFilter(type, v)}
          />
        ))}
      </SettingGroup>

      <SettingGroup title={t('settings_export')}>
        <div className="flex flex-wrap gap-2 py-2">
          <button onClick={handleExport} className="px-3 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200">{t('settings_export')}</button>
          <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200">{t('settings_import')}</button>
          <button onClick={() => setShowReset(true)} className="px-3 py-1.5 text-xs rounded bg-red-900/60 hover:bg-red-800 text-red-300">{t('settings_reset_all')}</button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        </div>
        {toast && <div className="text-xs text-emerald-400 mt-1">{toast}</div>}
      </SettingGroup>

      <SettingGroup title={t('settings_edit_json')}>
        <button
          onClick={() => { setJsonOpen(!jsonOpen); if (!jsonOpen) setJsonText(JSON.stringify(exportConfig(), null, 2)); }}
          className="text-xs text-zinc-400 hover:text-zinc-200 mb-2"
        >
          {jsonOpen ? '▼' : '▶'} {t('settings_edit_json')}
        </button>
        {jsonOpen && (
          <div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full h-60 bg-zinc-950 border border-zinc-700 rounded text-[11px] font-mono text-zinc-300 p-2 resize-y focus:outline-none focus:ring-1 focus:ring-emerald-600"
              placeholder={t('settings_json_placeholder')}
            />
            <button onClick={handleApplyJson} className="mt-2 px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white">{t('settings_apply_json')}</button>
          </div>
        )}
      </SettingGroup>

      {showReset && (
        <ConfirmDialog
          title={t('settings_reset_confirm_title')}
          message={t('settings_reset_confirm_msg')}
          confirmLabel={t('settings_reset_all')}
          cancelLabel={t('close')}
          onConfirm={handleReset}
          onCancel={() => setShowReset(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc -b --noEmit
git add web/src/components/settings/tabs/PlaybackTab.tsx web/src/components/settings/tabs/GeneralTab.tsx
git commit -m "feat: add PlaybackTab and GeneralTab with import/export/reset/JSON editor"
```

---

### Task 10: Wire Tabs into SettingsPanel + Delete Old Settings.tsx

**Files:**
- Modify: `web/src/components/settings/SettingsPanel.tsx`
- Delete: `web/src/components/Settings.tsx`

- [ ] **Step 1: Update SettingsPanel to import and render all tabs**

Replace the placeholder `<div className="text-xs text-zinc-500">Tab: {activeTab}</div>` with:

```typescript
// Add imports at top:
import { MapTab } from './tabs/MapTab';
import { ColorsTab } from './tabs/ColorsTab';
import { UnitsTab } from './tabs/UnitsTab';
import { TrailsTab } from './tabs/TrailsTab';
import { EffectsTab } from './tabs/EffectsTab';
import { BallisticsTab } from './tabs/BallisticsTab';
import { PlaybackTab } from './tabs/PlaybackTab';
import { GeneralTab } from './tabs/GeneralTab';

// Replace placeholder with (use React.ComponentType, not JSX.Element — erasableSyntaxOnly):
const TAB_CONTENT: Record<TabKey, React.ComponentType> = {
  map: MapTab,
  colors: ColorsTab,
  units: UnitsTab,
  trails: TrailsTab,
  effects: EffectsTab,
  ballistics: BallisticsTab,
  playback: PlaybackTab,
  general: GeneralTab,
};

// In render, replace placeholder:
const ActiveTab = TAB_CONTENT[activeTab];
// ... <ActiveTab />
```

- [ ] **Step 2: Delete old Settings.tsx**

```bash
rm web/src/components/Settings.tsx
```

Remove any imports of `Settings` from other files (check `TopBar.tsx`, `App.tsx`).

- [ ] **Step 3: Verify compiles and commit**

```bash
cd web && npx tsc -b --noEmit
git add -A
git commit -m "feat: wire all tabs into SettingsPanel, remove old Settings.tsx"
```

---

## Phase 3: App Integration

### Task 11: Wire SettingsPanel into App.tsx + TopBar + ShortcutHelp

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/TopBar.tsx`
- Modify: `web/src/components/ShortcutHelp.tsx`

- [ ] **Step 1: Add showSettings state + keyboard shortcut in App.tsx**

Add `showSettings` state (matches existing `showShortcuts` pattern), `,` key handler, render `SettingsPanel`, pass `onShowSettings` to TopBar. Also update auto-play effect to read `autoPlay` from `useVisualConfig`.

Key changes:
```typescript
// Import
import { SettingsPanel } from './components/settings/SettingsPanel';
import { useVisualConfig } from './store/visualConfig';

// State
const [showSettings, setShowSettings] = useState(false);

// In auto-play effect:
const { autoPlay } = useVisualConfig.getState();
if (connected && !autoPlayedRef.current && autoPlay) { ... }

// Keyboard: , key
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === ',') setShowSettings((prev) => !prev);
    if (e.key === 'Escape' && showSettings) setShowSettings(false);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [showSettings]);

// In TopBar:
<TopBar onShowShortcuts={...} onShowSettings={() => setShowSettings(true)} />

// Render:
{showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
```

- [ ] **Step 2: Add gear button in TopBar**

Add `onShowSettings` to TopBar props. Add a gear icon button next to `?`:

```tsx
{onShowSettings && (
  <button
    onClick={onShowSettings}
    className="w-6 h-6 flex items-center justify-center rounded text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
    title={`${t('settings')} (,)`}
  >
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  </button>
)}
```

- [ ] **Step 3: Add `,` shortcut to ShortcutHelp**

Add to the `shortcut_display` section:
```typescript
{ key: ',', i18nKey: 'sk_settings' },
```

- [ ] **Step 4: Verify compiles, lint, commit**

```bash
cd web && npx tsc -b --noEmit && npm run lint
git add web/src/App.tsx web/src/components/TopBar.tsx web/src/components/ShortcutHelp.tsx
git commit -m "feat: wire settings panel into App with gear button and comma shortcut"
```

---

## Phase 4: Consumer Integration (Map Layers)

### Task 12: Integrate visualConfig into MapView.tsx

**Files:**
- Modify: `web/src/map/MapView.tsx`

- [ ] **Step 1: Replace hardcoded intro animation values with visualConfig**

Read `useVisualConfig` in MapView. Replace hardcoded intro params:
- `duration: 3500` → `vc.introDuration * 1000`
- `pitch: 50` → `vc.introPitch`
- `bearing: -15` → `vc.introBearing`
- `maxZoom: 18` → `vc.maxZoom`
- Padding `0.15` → `vc.boundsPadding / 100`
- Globe projection conditional on `vc.globeProjection`
- Intro animation conditional on `vc.introAnimation`

- [ ] **Step 2: Verify and commit**

```bash
cd web && npx tsc -b --noEmit
git add web/src/map/MapView.tsx
git commit -m "feat: MapView reads intro/globe/zoom params from visualConfig"
```

---

### Task 13: Integrate visualConfig into UnitLayer + unitIcons

**Files:**
- Modify: `web/src/map/unitIcons.ts`
- Modify: `web/src/map/UnitLayer.tsx`

This is the most complex consumer integration. `unitIcons.ts` generates canvas icons with hardcoded colors and sizes. It needs to:
1. Accept color/size parameters
2. Use `map.hasImage(id) ? map.updateImage(id, data) : map.addImage(id, data)` pattern
3. Be called from a `useEffect` in UnitLayer that watches color/size changes

- [ ] **Step 1: Refactor unitIcons.ts to accept params**

Modify `registerUnitIcons(map)` to `registerUnitIcons(map, config)` where config includes team colors and icon size. Replace hardcoded `ICON_SIZE`, team color objects with params. Change `if (!map.hasImage(id))` guard to update-or-add pattern.

- [ ] **Step 2: Update UnitLayer to read from visualConfig and trigger icon regeneration**

Read `unitIconSize, redTeamColor, blueTeamColor, redDeadColor, blueDeadColor, deadOpacity, selectionColor, defaultFollowZoom` from `useVisualConfig()`. Add a `useEffect` watching these color/size values that calls the refactored `registerUnitIcons`. Replace hardcoded animation durations and colors throughout the render function.

- [ ] **Step 3: Verify and commit**

```bash
cd web && npx tsc -b --noEmit
git add web/src/map/unitIcons.ts web/src/map/UnitLayer.tsx
git commit -m "feat: UnitLayer + unitIcons read colors/sizes from visualConfig"
```

---

### Task 14: Integrate visualConfig into TrailLayer, SniperTracerLayer, BombingLayer, HotspotLayers

**Files:**
- Modify: `web/src/map/TrailLayer.tsx`
- Modify: `web/src/map/SniperTracerLayer.tsx`
- Modify: `web/src/map/BombingLayer.tsx`
- Modify: `web/src/map/HotspotLayer.tsx`
- Modify: `web/src/map/HotspotActivityCircle.tsx`

- [ ] **Step 1: TrailLayer — replace hardcoded trail/line widths, colors, durations**

Read `trailWidth, trailOpacity, trailLength, killLineWidth, killLineDuration, killLineStyle, hitLineWidth, hitLineDuration, killLineColor, hitLineColor, redTrailColor, blueTrailColor` from `useVisualConfig()`. Replace the hardcoded `TRACER_DURATION_MS`, line widths, and colors with these values.

- [ ] **Step 2: SniperTracerLayer — replace hardcoded tracer params**

Read `sniperTracerEnabled, tracerSpeed, tracerWidth, tracerGlow, tracerDuration, sniperTracerColor` from `useVisualConfig()`. Replace `TRACER_DURATION_MS`, `LINGER_MS`, line widths, and colors. Skip rendering entirely if `!sniperTracerEnabled`.

- [ ] **Step 3: BombingLayer — replace hardcoded bombing params**

Read `bombingDuration, bombingRadius, bombingColor` from `useVisualConfig()`. Replace `SHOCKWAVE_DURATION_MS` and colors.

- [ ] **Step 4: HotspotLayer + HotspotActivityCircle — replace hotspot circle color**

Read `hotspotCircleColor` from `useVisualConfig()`. Use as the base hue for generating per-type colors (multiply existing pattern with user's chosen base).

- [ ] **Step 5: Verify and commit**

```bash
cd web && npx tsc -b --noEmit && npm run lint
git add web/src/map/TrailLayer.tsx web/src/map/SniperTracerLayer.tsx web/src/map/BombingLayer.tsx web/src/map/HotspotLayer.tsx web/src/map/HotspotActivityCircle.tsx
git commit -m "feat: TrailLayer, SniperTracerLayer, BombingLayer, HotspotLayers read from visualConfig"
```

---

## Phase 5: Full Build Verification

### Task 15: Full Build + Lint

- [ ] **Step 1: Run full type check + lint**

```bash
cd /Users/s045pd/workobj/BackupData/DocumentArchive/GitHub/WarGame/wargame-replay/web
npx tsc -b --noEmit && npm run lint
```

- [ ] **Step 2: Run production build**

```bash
npm run build
```

- [ ] **Step 3: Commit any remaining fixes**

---

## Phase 6: Go Backend — Browser Launcher

### Task 16: Create `server/browser/` Package

**Files:**
- Create: `server/browser/open.go`
- Create: `server/browser/detect.go`
- Create: `server/browser/open_darwin.go`
- Create: `server/browser/open_windows.go`
- Create: `server/browser/open_linux.go`

- [ ] **Step 1: Create detect.go — Chrome/Edge path detection**

```go
// server/browser/detect.go
package browser

import (
	"os"
	"os/exec"
	"runtime"
)

// findChrome returns the path to Chrome if installed, or "".
func findChrome() string {
	switch runtime.GOOS {
	case "darwin":
		p := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
		if _, err := os.Stat(p); err == nil {
			return p
		}
	case "windows":
		for _, base := range []string{
			os.Getenv("ProgramFiles"),
			os.Getenv("ProgramFiles(x86)"),
			os.Getenv("LocalAppData"),
		} {
			if base == "" {
				continue
			}
			p := base + `\Google\Chrome\Application\chrome.exe`
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	default: // linux
		for _, name := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	return ""
}

// findEdge returns the path to Edge if installed, or "".
func findEdge() string {
	switch runtime.GOOS {
	case "darwin":
		p := "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
		if _, err := os.Stat(p); err == nil {
			return p
		}
	case "windows":
		for _, base := range []string{
			os.Getenv("ProgramFiles(x86)"),
			os.Getenv("ProgramFiles"),
		} {
			if base == "" {
				continue
			}
			p := base + `\Microsoft\Edge\Application\msedge.exe`
			if _, err := os.Stat(p); err == nil {
				return p
			}
		}
	default:
		for _, name := range []string{"microsoft-edge", "microsoft-edge-stable"} {
			if p, err := exec.LookPath(name); err == nil {
				return p
			}
		}
	}
	return ""
}
```

- [ ] **Step 2: Create open.go — main Open function**

```go
// server/browser/open.go
package browser

import (
	"log"
	"os/exec"
)

// Open launches url in the best available browser.
// Priority: Chrome --app → Edge --app → system default.
func Open(url string) error {
	appArgs := []string{"--app=" + url, "--new-window", "--disable-extensions", "--window-size=1280,800"}

	if chrome := findChrome(); chrome != "" {
		log.Printf("Opening %s in Chrome --app mode", url)
		return exec.Command(chrome, appArgs...).Start()
	}
	if edge := findEdge(); edge != "" {
		log.Printf("Opening %s in Edge --app mode", url)
		return exec.Command(edge, appArgs...).Start()
	}

	log.Printf("No Chrome/Edge found, opening %s in default browser", url)
	return openDefault(url)
}

// OpenDefault opens url in the system default browser.
func OpenDefault(url string) error {
	return openDefault(url)
}

// openDefault is implemented per-platform in open_darwin.go, open_windows.go, open_linux.go.
// No fallback needed — these three build tags cover all release targets.
```

- [ ] **Step 3: Create platform-specific openDefault implementations**

```go
// server/browser/open_darwin.go
//go:build darwin

package browser

import "os/exec"

func openDefault(url string) error {
	return exec.Command("open", url).Start()
}
```

```go
// server/browser/open_windows.go
//go:build windows

package browser

import "os/exec"

func openDefault(url string) error {
	return exec.Command("cmd", "/c", "start", url).Start()
}
```

```go
// server/browser/open_linux.go
//go:build linux

package browser

import "os/exec"

func openDefault(url string) error {
	return exec.Command("xdg-open", url).Start()
}
```

- [ ] **Step 4: Verify Go compiles**

```bash
cd /Users/s045pd/workobj/BackupData/DocumentArchive/GitHub/WarGame/wargame-replay/server && go vet ./browser/...
```

- [ ] **Step 5: Commit**

```bash
git add server/browser/
git commit -m "feat: add browser package for cross-platform Chrome --app detection and opening"
```

---

### Task 17: Create Windows Log Init + Update main.go

**Files:**
- Create: `server/winlog_windows.go`
- Modify: `server/main.go`

- [ ] **Step 1: Create winlog_windows.go**

```go
// server/winlog_windows.go
//go:build windows

package main

import (
	"log"
	"os"
	"path/filepath"
	"syscall"
)

const ATTACH_PARENT_PROCESS = ^uint32(0) // 0xFFFFFFFF

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procAttachConsole = kernel32.NewProc("AttachConsole")
)

func init() {
	// Try to attach to parent console (e.g., when launched from PowerShell).
	// This restores stdout/stderr for terminal users even with -H windowsgui.
	r, _, _ := procAttachConsole.Call(uintptr(ATTACH_PARENT_PROCESS))
	if r != 0 {
		// Successfully attached — stdout/stderr now work in the terminal
		return
	}

	// No parent console (double-click launch) — redirect logs to file
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		return
	}
	logDir := filepath.Join(localAppData, "MilSimReplay")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return
	}
	logPath := filepath.Join(logDir, "server.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	log.SetOutput(f)
}
```

- [ ] **Step 2: Add -open/-app flags and browser launch goroutine to main.go**

Key changes to `main.go`:

```go
import "wargame-replay/server/browser"

// In flag parsing section, add:
openBrowser := flag.Bool("open", true, "auto-open browser on startup")
appMode := flag.Bool("app", true, "prefer Chrome/Edge --app mode (no URL bar)")

// After srv.ListenAndServe (or wherever the Gin server starts):
go func() {
    for i := 0; i < 30; i++ {
        resp, err := http.Get("http://" + addr + "/api/health")
        if err == nil {
            resp.Body.Close()
            if resp.StatusCode == 200 {
                if *openBrowser {
                    if *appMode {
                        _ = browser.Open("http://" + addr)
                    } else {
                        _ = browser.OpenDefault("http://" + addr)
                    }
                }
                return
            }
        }
        time.Sleep(500 * time.Millisecond)
    }
}()
```

- [ ] **Step 3: Verify Go compiles**

```bash
cd server && go vet ./...
```

- [ ] **Step 4: Commit**

```bash
git add server/winlog_windows.go server/main.go
git commit -m "feat: add -open/-app flags and auto-open browser with Chrome --app mode"
```

---

### Task 18: Simplify macOS launcher + Update release.yml

**Files:**
- Modify: `assets/macos/launcher.sh`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Simplify launcher.sh**

Replace with:
```bash
#!/bin/bash
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY="$SELF_DIR/../Resources/wargame-replay"
DATA_DIR="${HOME}/MilSimReplay"
mkdir -p "$DATA_DIR"
exec "$BINARY" -dir "$DATA_DIR" -open
```

- [ ] **Step 2: Add -H windowsgui to Windows build in release.yml**

Find the Windows build command and add `-H windowsgui` to ldflags:
```yaml
# Change from:
-ldflags="-s -w -X main.version=${{ github.ref_name }}"
# To (Windows only):
-ldflags="-s -w -H windowsgui -X main.version=${{ github.ref_name }}"
```

This should only apply to Windows targets (check the matrix conditional).

- [ ] **Step 3: Verify launcher.sh is executable**

```bash
chmod +x assets/macos/launcher.sh
```

- [ ] **Step 4: Commit**

```bash
git add assets/macos/launcher.sh .github/workflows/release.yml
git commit -m "feat: simplify macOS launcher, add -H windowsgui for Windows builds"
```

---

## Phase 7: Final Verification

### Task 19: Full Build + Backend Tests

- [ ] **Step 1: Frontend full build**

```bash
cd /Users/s045pd/workobj/BackupData/DocumentArchive/GitHub/WarGame/wargame-replay/web
npx tsc -b --noEmit && npm run lint && npm run build
```

- [ ] **Step 2: Backend vet + test**

```bash
cd /Users/s045pd/workobj/BackupData/DocumentArchive/GitHub/WarGame/wargame-replay/server
go vet ./...
go test -race ./...
```

- [ ] **Step 3: Full production build**

```bash
cd /Users/s045pd/workobj/BackupData/DocumentArchive/GitHub/WarGame/wargame-replay
make build
```

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: fix any remaining build issues"
```
