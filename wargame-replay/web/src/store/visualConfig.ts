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

  // Colors
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

  // Units
  unitIconSize: 28,
  showUnitLabel: false,
  labelFontSize: 11,
  deadUnitDisplay: 'fade' as const,
  deadOpacity: 0.5,
  selectionRing: true,
  defaultFollowZoom: 19,

  // Trails & Lines
  trailWidth: 2,
  trailOpacity: 0.6,
  trailLength: 100,
  killLineWidth: 4,
  killLineDuration: 3,
  killLineStyle: 'solid' as const,
  hitLineWidth: 2.5,
  hitLineDuration: 2,

  // Effects
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

  // Ballistics
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
