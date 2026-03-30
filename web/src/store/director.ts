import { create } from 'zustand';

export type AppMode = 'replay' | 'director';

export interface TargetCamera {
  // For wgs84: lng/lat
  lng?: number;
  lat?: number;
  // For relative: x/y in [0,1]
  x?: number;
  y?: number;
  zoom?: number;
}

interface DirectorState {
  mode: AppMode;
  autoMode: boolean;
  currentCamera: TargetCamera | null;
  targetCamera: TargetCamera | null;
  hotspotScore: number;
  nextSwitchCountdown: number;
  lastSwitchTime: number;

  // Actions
  setMode: (mode: AppMode) => void;
  toggleAutoMode: () => void;
  setTargetCamera: (camera: TargetCamera) => void;
  setHotspotScore: (score: number) => void;
  setNextSwitchCountdown: (countdown: number) => void;
  recordSwitch: () => void;
}

export const useDirector = create<DirectorState>((set) => ({
  mode: 'replay',
  autoMode: false,
  currentCamera: null,
  targetCamera: null,
  hotspotScore: 0,
  nextSwitchCountdown: 0,
  lastSwitchTime: 0,

  setMode: (mode) => set({ mode }),

  toggleAutoMode: () => set((state) => ({ autoMode: !state.autoMode })),

  setTargetCamera: (camera) =>
    set({ targetCamera: camera, currentCamera: camera }),

  setHotspotScore: (score) => set({ hotspotScore: score }),

  setNextSwitchCountdown: (countdown) => set({ nextSwitchCountdown: countdown }),

  recordSwitch: () => set({ lastSwitchTime: Date.now() }),
}));
