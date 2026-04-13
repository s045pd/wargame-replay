// ── Playback store for browser-only (lite) mode ──
// Replaces WebSocket-driven playback with EngineBridge + local timer.

import { create } from 'zustand';
import type { GameMeta, GameEvent, UnitPosition, POIObject, HotspotEvent, Frame } from '../lib/api';
import type { MapStyleKey } from '../map/styles';
import { useVisualConfig } from './visualConfig';
import { EngineBridge } from '../engine/bridge';

// ── LocalStorage persistence for user preferences ──
const LS_KEY = 'wargame-prefs';

interface StoredPrefs {
  mapStyle?: string;
  speed?: number;
  trailEnabled?: boolean;
  tiltMode?: boolean;
  killLineEnabled?: boolean;
  hitLineEnabled?: boolean;
  reviveEffectEnabled?: boolean;
  healEffectEnabled?: boolean;
  hitFeedbackEnabled?: boolean;
  deathEffectEnabled?: boolean;
  killstreakSlowDiv?: number;
  longRangeSlowSpeed?: number;
  bombardSlowDiv?: number;
  focusDarkMap?: boolean;
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

// ── Tick rate calculation (mirrors ws/stream.go tickParams) ──
function tickParams(speed: number): { intervalMs: number; step: number } {
  if (speed <= 16) {
    return { intervalMs: 1000 / speed, step: 1 };
  }
  return { intervalMs: 62.5, step: Math.round(speed / 16) };
}

interface PlaybackState {
  // Connection / engine
  gameId: string | null;
  meta: GameMeta | null;
  connected: boolean;
  bridge: EngineBridge | null;

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

  // Pre-computed data (loaded once during init)
  allHotspots: HotspotEvent[];
  allKills: GameEvent[];

  // All timestamps from time index (for stepping)
  _timestamps: string[];
  _tsIndex: number;
  _tickTimer: ReturnType<typeof setInterval> | null;
  _prevTs: string;

  // Map UI state
  mapStyle: MapStyleKey;
  styleNonce: number;
  trailEnabled: boolean;
  tiltMode: boolean;
  selectedUnitId: number | null;
  followSelectedUnit: boolean;
  manualFollow: boolean;

  // Visual effect toggles
  killLineEnabled: boolean;
  hitLineEnabled: boolean;
  reviveEffectEnabled: boolean;
  healEffectEnabled: boolean;
  hitFeedbackEnabled: boolean;
  deathEffectEnabled: boolean;

  // Hotspot slowdown settings
  killstreakSlowDiv: number;
  longRangeSlowSpeed: number;
  bombardSlowDiv: number;

  // Actions
  setGame: (meta: GameMeta, hotspots: HotspotEvent[], allKills: GameEvent[], bridge: EngineBridge, timestamps: string[]) => void;
  setAllHotspots: (hotspots: HotspotEvent[]) => void;
  setAllKills: (kills: GameEvent[]) => void;
  resetGame: () => void;
  connectWs: () => void;
  disconnectWs: () => void;
  play: (speed?: number) => void;
  pause: () => void;
  seek: (ts: string) => void;
  setSpeed: (speed: number) => void;
  setMapStyle: (style: MapStyleKey) => void;
  bumpStyleNonce: () => void;
  setTrailEnabled: (enabled: boolean) => void;
  toggleTiltMode: () => void;
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

/** Apply a frame to the store. */
function applyFrame(frame: Frame, set: (partial: Partial<PlaybackState>) => void) {
  set({
    currentTs: frame.ts,
    units: frame.units,
    events: frame.events ?? [],
    hotspots: frame.hotspots ?? [],
    pois: frame.pois ?? [],
  });
}

/** Binary search for index of first timestamp >= ts. */
function bisect(timestamps: string[], ts: string): number {
  let lo = 0, hi = timestamps.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (timestamps[mid]! < ts) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, timestamps.length - 1);
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  gameId: null,
  meta: null,
  connected: false,
  bridge: null,
  currentTs: '',
  playing: false,
  speed: _prefs.speed ?? 64,
  coordMode: 'relative',
  units: [],
  events: [],
  hotspots: [],
  pois: [],
  allHotspots: [],
  allKills: [],
  _timestamps: [],
  _tsIndex: 0,
  _tickTimer: null,
  _prevTs: '',
  mapStyle: (_prefs.mapStyle as MapStyleKey) ?? 'satellite',
  styleNonce: 0,
  trailEnabled: _prefs.trailEnabled ?? true,
  tiltMode: _prefs.tiltMode ?? false,
  selectedUnitId: null,
  followSelectedUnit: false,
  manualFollow: false,
  killLineEnabled: _prefs.killLineEnabled ?? true,
  hitLineEnabled: _prefs.hitLineEnabled ?? true,
  reviveEffectEnabled: _prefs.reviveEffectEnabled ?? true,
  healEffectEnabled: _prefs.healEffectEnabled ?? true,
  hitFeedbackEnabled: _prefs.hitFeedbackEnabled ?? true,
  deathEffectEnabled: _prefs.deathEffectEnabled ?? true,
  killstreakSlowDiv: _prefs.killstreakSlowDiv ?? 4,
  longRangeSlowSpeed: _prefs.longRangeSlowSpeed ?? 0,
  bombardSlowDiv: _prefs.bombardSlowDiv ?? 4,

  setGame: (meta, hotspots, allKills, bridge, timestamps) => {
    const defaultSpd = useVisualConfig.getState().defaultSpeed || 64;
    set({
      gameId: 'local',
      meta,
      coordMode: meta.coordMode as 'wgs84' | 'relative',
      currentTs: meta.startTime,
      connected: true,
      bridge,
      allHotspots: hotspots,
      allKills: allKills,
      _timestamps: timestamps,
      _tsIndex: 0,
      speed: defaultSpd,
    });
  },

  setAllHotspots: (hotspots) => set({ allHotspots: hotspots }),
  setAllKills: (kills) => set({ allKills: kills }),

  resetGame: () => {
    const { _tickTimer, bridge } = get();
    if (_tickTimer) clearInterval(_tickTimer);
    bridge?.dispose();
    set({
      gameId: null,
      meta: null,
      connected: false,
      bridge: null,
      currentTs: '',
      playing: false,
      units: [],
      events: [],
      hotspots: [],
      pois: [],
      allHotspots: [],
      allKills: [],
      _timestamps: [],
      _tsIndex: 0,
      _tickTimer: null,
      _prevTs: '',
    });
  },

  // No-op in lite mode — connection is established via setGame()
  connectWs: () => {},
  disconnectWs: () => {
    const { _tickTimer, bridge } = get();
    if (_tickTimer) clearInterval(_tickTimer);
    bridge?.dispose();
    set({ bridge: null, connected: false, _tickTimer: null });
  },

  play: (speed) => {
    const state = get();
    const s = speed ?? state.speed;

    // Clear existing timer
    if (state._tickTimer) clearInterval(state._tickTimer);

    const { intervalMs, step } = tickParams(s);

    const timer = setInterval(async () => {
      const st = get();
      if (!st.bridge || !st.playing) return;

      const nextIdx = Math.min(st._tsIndex + step, st._timestamps.length - 1);
      const nextTs = st._timestamps[nextIdx];
      if (!nextTs || nextIdx === st._tsIndex) {
        // End of replay
        get().pause();
        return;
      }

      const prevTs = st._prevTs || st.currentTs;
      try {
        let frame: Frame;
        if (step > 1) {
          // Fast-forward: collect events over the skipped range
          frame = await st.bridge.getFrameRange(prevTs, nextTs);
        } else {
          frame = await st.bridge.getFrame(nextTs);
        }
        applyFrame(frame, set);
        set({ _tsIndex: nextIdx, _prevTs: nextTs });
      } catch {
        // Skip frame on error
        set({ _tsIndex: nextIdx });
      }
    }, intervalMs);

    set({ playing: true, speed: s, _tickTimer: timer });
  },

  pause: () => {
    const { _tickTimer } = get();
    if (_tickTimer) clearInterval(_tickTimer);
    set({ playing: false, _tickTimer: null });
  },

  seek: async (ts) => {
    const state = get();
    if (!state.bridge) return;

    // Find closest timestamp index
    const idx = bisect(state._timestamps, ts);
    const actualTs = state._timestamps[idx];
    if (!actualTs) return;

    set({ currentTs: actualTs, _tsIndex: idx, _prevTs: actualTs });

    try {
      const frame = await state.bridge.getFrame(actualTs);
      applyFrame(frame, set);
    } catch {
      // ignore
    }
  },

  setSpeed: (speed) => {
    if (get().playing) {
      // play() clears old timer and starts new one — no pause/resume needed,
      // which avoids briefly setting playing=false and triggering director cleanup
      get().play(speed);
    } else {
      set({ speed });
    }
    savePrefs({ speed });
  },

  setMapStyle: (style) => { set({ mapStyle: style }); savePrefs({ mapStyle: style }); },
  bumpStyleNonce: () => set((s) => ({ styleNonce: s.styleNonce + 1 })),
  setTrailEnabled: (enabled) => { set({ trailEnabled: enabled }); savePrefs({ trailEnabled: enabled }); },
  toggleTiltMode: () => {
    const next = !get().tiltMode;
    set({ tiltMode: next });
    savePrefs({ tiltMode: next });
  },
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
