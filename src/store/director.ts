import { create } from 'zustand';
import { usePlayback, savePrefs } from './playback';

export type AppMode = 'replay' | 'director';

export interface TargetCamera {
  // For wgs84: lng/lat
  lng?: number;
  lat?: number;
  // For relative: x/y in [0,1]
  x?: number;
  y?: number;
  zoom?: number;
  // Geographic bounds — triggers fitBounds instead of flyTo
  bounds?: [[number, number], [number, number]]; // [[sw_lng, sw_lat], [ne_lng, ne_lat]]
}

/** Recorded camera switch event for the timeline camera track */
export interface CameraHistoryEntry {
  gameTs: string;   // in-game timestamp when the switch happened
  auto: boolean;    // true = auto-director, false = manual (user click)
}

/** Maximum camera history entries to keep */
const MAX_CAMERA_HISTORY = 500;

/** Focus mode — activated during killstreak / long_range personal hotspots */
export interface FocusMode {
  active: boolean;
  focusUnitId: number;          // the killstreak player
  relatedUnitIds: number[];     // targets (hit/killed units)
  previousMapStyle: string;     // to restore when exiting focus mode
}

const FOCUS_MODE_OFF: FocusMode = {
  active: false,
  focusUnitId: -1,
  relatedUnitIds: [],
  previousMapStyle: '',
};

/** Speed slowdown state managed by auto-director */
export interface Slowdown {
  active: boolean;
  originalSpeed: number | null;  // user's speed before director slowed it
}

const SLOWDOWN_OFF: Slowdown = { active: false, originalSpeed: null };

interface DirectorState {
  mode: AppMode;
  autoMode: boolean;
  currentCamera: TargetCamera | null;
  targetCamera: TargetCamera | null;
  hotspotScore: number;
  nextSwitchCountdown: number;
  lastSwitchTime: number;
  /** ID of the hotspot currently being tracked by auto-director */
  activeHotspotId: number | null;
  /** Camera switch history for timeline track visualization */
  cameraHistory: CameraHistoryEntry[];
  /** Focus mode state for personal hotspot highlight */
  focusMode: FocusMode;
  /** Director-computed zoom for follow mode (controls MapView chase loop target zoom) */
  followZoom: number | null;
  /** Speed slowdown state (replaces ref-based speed bookkeeping) */
  slowdown: Slowdown;
  /** True when auto-director is locked to a personal hotspot — switching is forbidden */
  switchLocked: boolean;
  /** Whether focus mode should switch to dark map (true) or keep current map style (false) */
  focusDarkMap: boolean;
  /** Immersive mode — hides most UI for a cinematic viewing experience */
  immersive: boolean;
  /** Set to true by manual hotspot click — tells auto-director to reset internal refs and yield */
  manualOverride: boolean;

  // ── Actions ──
  setMode: (mode: AppMode) => void;
  toggleAutoMode: () => void;
  setTargetCamera: (camera: TargetCamera) => void;
  setHotspotScore: (score: number) => void;
  setNextSwitchCountdown: (countdown: number) => void;
  recordSwitch: () => void;
  setActiveHotspotId: (id: number | null) => void;
  clearCameraHistory: () => void;
  setFollowZoom: (zoom: number | null) => void;
  activateFocusMode: (focusUnitId: number, relatedUnitIds: number[], currentMapStyle: string) => void;
  /** Exit focus mode: restore map style + clear followZoom + reset state */
  exitFocusMode: () => void;
  /** Save current speed as original and apply slow speed */
  activateSlowdown: (slowSpeed: number) => void;
  /** Restore original speed and clear slowdown */
  restoreSpeed: () => void;
  setSwitchLocked: (locked: boolean) => void;
  setManualOverride: (v: boolean) => void;
  toggleFocusDarkMap: () => void;
  toggleImmersive: () => void;
}

export const useDirector = create<DirectorState>((set, get) => ({
  mode: 'director',
  autoMode: true,
  currentCamera: null,
  targetCamera: null,
  hotspotScore: 0,
  nextSwitchCountdown: 0,
  lastSwitchTime: 0,
  activeHotspotId: null,
  cameraHistory: [],
  focusMode: FOCUS_MODE_OFF,
  followZoom: null,
  slowdown: SLOWDOWN_OFF,
  switchLocked: false,
  focusDarkMap: (() => { try { const p = localStorage.getItem('wargame-prefs'); return p ? JSON.parse(p).focusDarkMap ?? true : true; } catch { return true; } })(),
  immersive: false,
  manualOverride: false,

  setMode: (mode) => set({ mode }),

  toggleAutoMode: () => set((state) => ({ autoMode: !state.autoMode })),

  setTargetCamera: (camera) =>
    set((state) => {
      const gameTs = usePlayback.getState().currentTs ?? '';
      const entry: CameraHistoryEntry = { gameTs, auto: state.autoMode };
      const history = [...state.cameraHistory, entry];
      return {
        targetCamera: camera,
        currentCamera: camera,
        cameraHistory: history.length > MAX_CAMERA_HISTORY
          ? history.slice(history.length - MAX_CAMERA_HISTORY)
          : history,
      };
    }),

  setHotspotScore: (score) => set({ hotspotScore: score }),

  setNextSwitchCountdown: (countdown) => set({ nextSwitchCountdown: countdown }),

  recordSwitch: () => set({ lastSwitchTime: Date.now() }),

  setActiveHotspotId: (id) => set({ activeHotspotId: id }),

  clearCameraHistory: () => set({ cameraHistory: [] }),

  setFollowZoom: (zoom) => set({ followZoom: zoom }),

  activateFocusMode: (focusUnitId, relatedUnitIds, currentMapStyle) =>
    set((state) => ({
      focusMode: {
        active: true,
        focusUnitId,
        relatedUnitIds,
        // When already in focus mode, preserve the original pre-focus style
        // so we don't save 'dark' as the "previous" and lose the real style.
        previousMapStyle: state.focusMode.active
          ? state.focusMode.previousMapStyle
          : currentMapStyle,
      },
    })),

  exitFocusMode: () => {
    const { focusMode: fm } = get();
    if (!fm.active) return;
    // MapView handles restoring raster brightness via paint properties —
    // no style swap needed (avoids full tile reload).
    set({ focusMode: FOCUS_MODE_OFF, followZoom: null });
  },

  activateSlowdown: (slowSpeed) => {
    const { slowdown } = get();
    // Capture original speed BEFORE any mutation
    const originalSpeed = slowdown.active
      ? slowdown.originalSpeed
      : usePlayback.getState().speed;
    // Mark active + save original in a single set() call, then apply slow speed
    set({ slowdown: { active: true, originalSpeed } });
    usePlayback.getState().setSpeed(slowSpeed);
  },

  restoreSpeed: () => {
    const { slowdown } = get();
    if (!slowdown.active || slowdown.originalSpeed === null) return;
    usePlayback.getState().setSpeed(slowdown.originalSpeed);
    set({ slowdown: SLOWDOWN_OFF });
  },

  setSwitchLocked: (locked) => set({ switchLocked: locked }),
  setManualOverride: (v) => set({ manualOverride: v }),
  toggleFocusDarkMap: () => set((s) => {
    const next = !s.focusDarkMap;
    savePrefs({ focusDarkMap: next });
    return { focusDarkMap: next };
  }),
  toggleImmersive: () => set((s) => ({ immersive: !s.immersive })),
}));
