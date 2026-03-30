const BASE = '';

export interface GameInfo {
  id: string;
  session: string;
  startTime: string;
  endTime: string;
  playerCount: number;
  filename: string;
  displayName: string;
}

export interface GameMeta {
  coordMode: 'wgs84' | 'relative';
  startTime: string;
  endTime: string;
  players: { id: number; name: string; team: string }[];
}

export interface UnitPosition {
  id: number;
  type: number;
  lat?: number;
  lng?: number;
  x?: number;
  y?: number;
  team: string;
  alive: boolean;
  flags: string;
}

export interface Frame {
  type: 'frame';
  ts: string;
  units: UnitPosition[];
  events: unknown[];
  hotspot?: { score: number; center: [number, number]; radius: number };
}

export async function fetchGames(): Promise<GameInfo[]> {
  const res = await fetch(`${BASE}/api/games`);
  return res.json();
}

export async function fetchMeta(gameId: string): Promise<GameMeta> {
  const res = await fetch(`${BASE}/api/games/${gameId}/meta`);
  return res.json();
}

export async function fetchFrame(gameId: string, ts: string): Promise<Frame> {
  const res = await fetch(`${BASE}/api/games/${gameId}/frame/${encodeURIComponent(ts)}`);
  return res.json();
}
