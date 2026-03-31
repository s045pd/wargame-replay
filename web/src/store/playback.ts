import { create } from 'zustand';
import { GameMeta, GameEvent, UnitPosition, Frame, POIObject } from '../lib/api';
import { GameWebSocket } from '../lib/ws';
import { MapStyleKey } from '../map/styles';

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
  hotspot: Frame['hotspot'];
  pois: POIObject[];

  // Map UI state
  mapStyle: MapStyleKey;
  trailEnabled: boolean;
  selectedUnitId: number | null;
  followSelectedUnit: boolean;

  // Actions
  setGame: (gameId: string, meta: GameMeta) => void;
  resetGame: () => void;
  connectWs: () => void;
  disconnectWs: () => void;
  play: (speed?: number) => void;
  pause: () => void;
  seek: (ts: string) => void;
  setSpeed: (speed: number) => void;
  setMapStyle: (style: MapStyleKey) => void;
  setTrailEnabled: (enabled: boolean) => void;
  setSelectedUnitId: (id: number | null) => void;
  setFollowSelectedUnit: (follow: boolean) => void;
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  gameId: null,
  meta: null,
  connected: false,
  ws: null,
  currentTs: '',
  playing: false,
  speed: 1,
  coordMode: 'relative',
  units: [],
  events: [],
  hotspot: undefined,
  pois: [],
  mapStyle: 'dark',
  trailEnabled: true,
  selectedUnitId: null,
  followSelectedUnit: false,

  setGame: (gameId, meta) => set({
    gameId, meta,
    coordMode: meta.coordMode as 'wgs84' | 'relative',
    currentTs: meta.startTime,
  }),

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
      hotspot: undefined,
      pois: [],
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
          hotspot: msg['hotspot'] as Frame['hotspot'],
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
  },

  setMapStyle: (style) => set({ mapStyle: style }),
  setTrailEnabled: (enabled) => set({ trailEnabled: enabled }),
  setSelectedUnitId: (id) => set({ selectedUnitId: id }),
  setFollowSelectedUnit: (follow) => set({ followSelectedUnit: follow }),
}));
