import { create } from 'zustand';
import { GameMeta, UnitPosition, Frame } from '../lib/api';
import { GameWebSocket } from '../lib/ws';

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
  events: unknown[];
  hotspot: Frame['hotspot'];

  // Actions
  setGame: (gameId: string, meta: GameMeta) => void;
  connectWs: () => void;
  disconnectWs: () => void;
  play: (speed?: number) => void;
  pause: () => void;
  seek: (ts: string) => void;
  setSpeed: (speed: number) => void;
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

  setGame: (gameId, meta) => set({
    gameId, meta,
    coordMode: meta.coordMode as 'wgs84' | 'relative',
    currentTs: meta.startTime,
  }),

  connectWs: () => {
    const { gameId } = get();
    if (!gameId) return;
    const ws = new GameWebSocket(gameId);
    ws.onMessage((data) => {
      const msg = data as Record<string, unknown>;
      if (msg['type'] === 'state') {
        set({
          connected: true,
          coordMode: msg['coordMode'] as 'wgs84' | 'relative',
          currentTs: msg['ts'] as string,
        });
      } else if (msg['type'] === 'frame') {
        set({
          currentTs: msg['ts'] as string,
          units: msg['units'] as UnitPosition[],
          events: msg['events'] as unknown[],
          hotspot: msg['hotspot'] as Frame['hotspot'],
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
}));
