import { create } from 'zustand';

const LS_KEY = 'wargame-visual';

// ── Default values (extracted from hardcoded constants across map layers) ──
export const VISUAL_DEFAULTS = {
  // Map
  globeProjection: true,
  introAnimation: true,
  introDuration: 8,
  introPitch: 60,
  introBearing: 180,
  maxZoom: 18,
  boundsPadding: 15,

  // Colors
  redTeamColor: '#e03030',
  redDeadColor: '#662222',
  blueTeamColor: '#1890ff',
  blueDeadColor: '#223366',
  killLineColor: '#ff3333',
  hitLineColor: '#ffcc00',
  sniperTracerColor: '#00ccff',
  bombingColor: '#ff3c14',
  selectionColor: '#ffffff',
  hotspotCircleColor: '#ffa000',

  // Units
  unitIconSize: 28,
  showUnitLabel: false,
  labelFontSize: 11,
  deadUnitDisplay: 'fade' as 'fade' | 'hide' | 'marker',
  deadOpacity: 0.85,
  selectionRing: true,
  defaultFollowZoom: 19,

  // Attack Lines
  killLineWidth: 3,
  killLineDuration: 0.5,
  killLineStyle: 'pulse' as 'solid' | 'dashed' | 'pulse',
  hitLineWidth: 3,
  hitLineDuration: 0.5,

  // Effects
  reviveDuration: 0.2,
  reviveIntensity: 0.05,
  reviveRingSize: 4,
  healDuration: 0.3,
  healGlowSize: 0.6,
  hitFlashDuration: 0.1,
  hitFlashIntensity: 0.05,
  hitRingSize: 2,
  deathDuration: 1.1,
  deathScale: 0.3,
  deathRingSize: 3,
  bombingRadius: true,
  bombingDuration: 2.5,

  // Ballistics
  sniperTracerEnabled: true,
  tracerSpeed: 1,
  tracerWidth: 2,
  tracerTrailLength: 35,
  tracerGlow: 0.2,
  tracerDuration: 1.1,

  // Playback additions
  defaultSpeed: 64,
  autoPlay: true,
  focusLockEnabled: false,   // false = lock until hotspot ends naturally; true = cap at focusLockDuration
  focusLockDuration: 6,

  // Director / Hotspot
  directorCooldown: 9.5,     // seconds between camera switches
  directorJitter: 0.3,       // ±fraction of cooldown randomness
  directorPreTrack: 8,       // seconds to pre-track before hotspot starts
  directorScorePower: 1.5,   // exponent for weighted random pick (higher = more deterministic)
  personalZoomPx: 500,       // target pixels for personal hotspot zoom
  groupZoomPx: 600,          // target pixels for group hotspot zoom
  directorMinZoom: 10.5,     // minimum zoom for director camera
  directorMaxZoom: 19,       // maximum zoom for director camera

  // Free tile zoom cap — free providers have lower max zoom than Mapbox
  freeMaxZoom: 16,           // max zoom when using free tiles (prevents "Map data not yet available")

  // Activity circle
  activityCircleMin: 50,     // min radius in meters
  activityCircleMax: 300,    // max radius in meters
} as const;

// Widen literal types from `as const` so that `set('key', value)` accepts
// any value of the primitive base type (string | number | boolean), not only
// the exact literal declared in VISUAL_DEFAULTS.
type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T;

export type VisualConfig = {
  -readonly [K in keyof typeof VISUAL_DEFAULTS]: Widen<(typeof VISUAL_DEFAULTS)[K]>;
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
