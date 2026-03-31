import { create } from 'zustand';
import { usePlayback } from './playback';

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

  // Actions
  setMode: (mode: AppMode) => void;
  toggleAutoMode: () => void;
  setTargetCamera: (camera: TargetCamera) => void;
  setHotspotScore: (score: number) => void;
  setNextSwitchCountdown: (countdown: number) => void;
  recordSwitch: () => void;
  setActiveHotspotId: (id: number | null) => void;
  clearCameraHistory: () => void;
}

export const useDirector = create<DirectorState>((set) => ({
  mode: 'director',
  autoMode: true,
  currentCamera: null,
  targetCamera: null,
  hotspotScore: 0,
  nextSwitchCountdown: 0,
  lastSwitchTime: 0,
  activeHotspotId: null,
  cameraHistory: [],

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
}));
