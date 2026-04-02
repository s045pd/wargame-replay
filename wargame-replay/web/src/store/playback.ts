import { create } from 'zustand';
import { GameMeta, GameEvent, UnitPosition, POIObject, HotspotEvent } from '../lib/api';
import { GameWebSocket } from '../lib/ws';
import { MapStyleKey } from '../map/styles';

// ── LocalStorage persistence for user preferences ──
const LS_KEY = 'wargame-prefs';

interface StoredPrefs {
  mapStyle?: string;
  speed?: number;
  trailEnabled?: boolean;
  killLineEnabled?: boolean;
  hitLineEnabled?: boolean;
  reviveEffectEnabled?: boolean;
  healEffectEnabled?: boolean;
  hitFeedbackEnabled?: boolean;
  deathEffectEnabled?: boolean;
  focusDarkMap?: boolean;
  killstreakSlowDiv?: number;
  longRangeSlowSpeed?: number;
  bombardSlowDiv?: number;
}

function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function savePrefs(partial: Partial<StoredPrefs>) {
  try {
    const current = loadPrefs();
    localStorage.setItem(LS_KEY, JSON.stringify({ ...current, ...partial }));
  } catch { /* ignore */ }
}

const _prefs = loadPrefs();

interface PlaybackState {
  // Connection
  gameId: string | null;
  meta: GameMeta | null;
  connected: boolean;
  ws: GameWebSocket | null;

  // Playback
  currentTs: string;
  playing: boolean;
  speed: number;
  coordMode: 'wgs84' | 'relative';

  // Frame data
  units: UnitPosition[];
  events: GameEvent[];
  hotspots: HotspotEvent[];
  pois: POIObject[];

  // Pre-computed full hotspot timeline (fetched once from REST API)
  allHotspots: HotspotEvent[];

  // Map UI state
  mapStyle: MapStyleKey;
  /** Incremented to force a map style reload (e.g. after Mapbox token change) */
  styleNonce: number;
  trailEnabled: boolean;
  selectedUnitId: number | null;
  followSelectedUnit: boolean;
  /** True when the user manually clicked follow — auto-director must not interfere */
  manualFollow: boolean;

  // Visual effect toggles
  /** Show kill attack lines (requires trailEnabled) */
  killLineEnabled: boolean;
  /** Show hit attack lines (requires trailEnabled) */
  hitLineEnabled: boolean;
  /** Show revive flash effect on units */
  reviveEffectEnabled: boolean;
  /** Show heal glow effect on units */
  healEffectEnabled: boolean;
  /** Show hit feedback flash on units */
  hitFeedbackEnabled: boolean;
  /** Show death animation effect on units */
  deathEffectEnabled: boolean;

  // Hotspot slowdown settings
  /** Killstreak slowdown divisor (speed / N), 0 = no slowdown */
  killstreakSlowDiv: number;
  /** Long-range slowdown target speed (absolute), 0 = no slowdown */
  longRangeSlowSpeed: number;
  /** Bombardment slowdown divisor (speed / N), 0 = no slowdown */
  bombardSlowDiv: number;

  // Actions
  setGame: (gameId: string, meta: GameMeta) => void;
  setAllHotspots: (hotspots: HotspotEvent[]) => void;
  resetGame: () => void;
  connectWs: () => void;
  disconnectWs: () => void;
  play: (speed?: number) => void;
  pause: () => void;
  seek: (ts: string) => void;
  setSpeed: (speed: number) => void;
  setMapStyle: (style: MapStyleKey) => void;
  /** Force the map to reload the current style (e.g. after Mapbox token changes) */
  bumpStyleNonce: () => void;
  setTrailEnabled: (enabled: boolean) => void;
  setSelectedUnitId: (id: number | null) => void;
  setFollowSelectedUnit: (follow: boolean) => void;
  setManualFollow: (manual: boolean) => void;
  setKillLineEnabled: (enabled: boolean) => void;
  setHitLineEnabled: (enabled: boolean) => void;
  setReviveEffectEnabled: (enabled: boolean) => void;
  setHealEffectEnabled: (enabled: boolean) => void;
  setHitFeedbackEnabled: (enabled: boolean) => void;
  setDeathEffectEnabled: (enabled: boolean) => void;
  setKillstreakSlowDiv: (div: number) => void;
  setLongRangeSlowSpeed: (speed: number) => void;
  setBombardSlowDiv: (div: number) => void;
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  gameId: null,
  meta: null,
  connected: false,
  ws: null,
  currentTs: '',
  playing: false,
  speed: _prefs.speed ?? 64,
  coordMode: 'relative',
  units: [],
  events: [],
  hotspots: [],
  pois: [],
  allHotspots: [],
  mapStyle: (_prefs.mapStyle as MapStyleKey) ?? 'satellite',
  styleNonce: 0,
  trailEnabled: _prefs.trailEnabled ?? true,
  selectedUnitId: null,
  followSelectedUnit: false,
  manualFollow: false,
  killLineEnabled: _prefs.killLineEnabled ?? true,
  hitLineEnabled: _prefs.hitLineEnabled ?? true,
  reviveEffectEnabled: _prefs.reviveEffectEnabled ?? true,
  healEffectEnabled: _prefs.healEffectEnabled ?? true,
  hitFeedbackEnabled: _prefs.hitFeedbackEnabled ?? true,
  deathEffectEnabled: _prefs.deathEffectEnabled ?? true,
  killstreakSlowDiv: _prefs.killstreakSlowDiv ?? 8,
  longRangeSlowSpeed: _prefs.longRangeSlowSpeed ?? 1,
  bombardSlowDiv: _prefs.bombardSlowDiv ?? 4,

  setGame: (gameId, meta) => set({
    gameId, meta,
    coordMode: meta.coordMode as 'wgs84' | 'relative',
    currentTs: meta.startTime,
  }),

  setAllHotspots: (hotspots) => set({ allHotspots: hotspots }),

  resetGame: () => {
    get().ws?.disconnect();
    set({
      gameId: null,
      meta: null,
      connected: false,
      ws: null,
      currentTs: '',
      playing: false,
      units: [],
      events: [],
      hotspots: [],
      pois: [],
      allHotspots: [],
    });
  },

  connectWs: () => {
    const { gameId } = get();
    if (!gameId) return;
    const ws = new GameWebSocket(gameId);
    ws.onMessage((data) => {
      const msg = data as Record<string, unknown>;
      if (msg['type'] === 'state') {
        const ts = msg['ts'] as string;
        set({
          connected: true,
          coordMode: msg['coordMode'] as 'wgs84' | 'relative',
          currentTs: ts,
        });
        // Fetch initial frame so the map can zoom to unit positions
        ws.send({ cmd: 'seek', to: ts });
      } else if (msg['type'] === 'frame') {
        const units = msg['units'] as UnitPosition[];
        set({
          currentTs: msg['ts'] as string,
          units,
          events: (msg['events'] as GameEvent[]) ?? [],
          hotspots: (msg['hotspots'] as HotspotEvent[]) ?? [],
          pois: (msg['pois'] as POIObject[]) ?? [],
        });
      }
    });
    ws.connect();
    set({ ws, connected: false });
  },

  disconnectWs: () => {
    get().ws?.disconnect();
    set({ ws: null, connected: false });
  },

  play: (speed) => {
    const s = speed ?? get().speed;
    get().ws?.send({ cmd: 'play', speed: s });
    set({ playing: true, speed: s });
  },

  pause: () => {
    get().ws?.send({ cmd: 'pause' });
    set({ playing: false });
  },

  seek: (ts) => {
    get().ws?.send({ cmd: 'seek', to: ts });
    set({ currentTs: ts });
  },

  setSpeed: (speed) => {
    if (get().playing) {
      get().ws?.send({ cmd: 'play', speed });
    }
    set({ speed });
    savePrefs({ speed });
  },

  setMapStyle: (style) => { set({ mapStyle: style }); savePrefs({ mapStyle: style }); },
  bumpStyleNonce: () => set((s) => ({ styleNonce: s.styleNonce + 1 })),
  setTrailEnabled: (enabled) => { set({ trailEnabled: enabled }); savePrefs({ trailEnabled: enabled }); },
  setSelectedUnitId: (id) => set(id === null ? { selectedUnitId: null, manualFollow: false } : { selectedUnitId: id }),
  setFollowSelectedUnit: (follow) => set(follow ? { followSelectedUnit: true } : { followSelectedUnit: false, manualFollow: false }),
  setManualFollow: (manual) => set({ manualFollow: manual }),
  setKillLineEnabled: (enabled) => { set({ killLineEnabled: enabled }); savePrefs({ killLineEnabled: enabled }); },
  setHitLineEnabled: (enabled) => { set({ hitLineEnabled: enabled }); savePrefs({ hitLineEnabled: enabled }); },
  setReviveEffectEnabled: (enabled) => { set({ reviveEffectEnabled: enabled }); savePrefs({ reviveEffectEnabled: enabled }); },
  setHealEffectEnabled: (enabled) => { set({ healEffectEnabled: enabled }); savePrefs({ healEffectEnabled: enabled }); },
  setHitFeedbackEnabled: (enabled) => { set({ hitFeedbackEnabled: enabled }); savePrefs({ hitFeedbackEnabled: enabled }); },
  setDeathEffectEnabled: (enabled) => { set({ deathEffectEnabled: enabled }); savePrefs({ deathEffectEnabled: enabled }); },
  setKillstreakSlowDiv: (div) => { set({ killstreakSlowDiv: div }); savePrefs({ killstreakSlowDiv: div }); },
  setLongRangeSlowSpeed: (speed) => { set({ longRangeSlowSpeed: speed }); savePrefs({ longRangeSlowSpeed: speed }); },
  setBombardSlowDiv: (div) => { set({ bombardSlowDiv: div }); savePrefs({ bombardSlowDiv: div }); },
}));
