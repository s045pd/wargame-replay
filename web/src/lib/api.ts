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

export interface BaseCamp {
  team: string;
  lat: number;
  lng: number;
}

export interface Graticule {
  latBegin: number;
  latSpace: number;
  lngBegin: number;
  lngSpace: number;
  cr: number;
}

export interface BombingEvent {
  ts: string;
  lat: number;
  lng: number;
  param: number;
  evType: number;
  subType: number;
}

export interface POIObject {
  id: number;
  type: number; // 1=base camp, 2=vehicle, 3=supply cache, 4=control point, 5=station
  team: number; // 0=red, 1=blue, 2=neutral
  resource: number;
  lat: number;
  lng: number;
}

export interface GameMeta {
  coordMode: 'wgs84' | 'relative';
  startTime: string;
  endTime: string;
  players: { id: number; name: string; team: string }[];
  centerLat?: number;
  centerLng?: number;
  bounds?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  baseCamps?: BaseCamp[];
  graticule?: Graticule;
  bombingEvents?: BombingEvent[];
}

export type UnitClass = 'rifle' | 'mg' | 'medic' | 'marksman' | 'sniper';

export const UNIT_CLASS_LABELS: Record<UnitClass, string> = {
  rifle: '步枪兵',
  mg: '机枪兵',
  medic: '医疗兵',
  marksman: '精确射手',
  sniper: '狙击手',
};

export interface UnitPosition {
  id: number;
  lat?: number;
  lng?: number;
  x?: number;
  y?: number;
  team: string;
  alive: boolean;
  hp: number;
  name?: string;
  class: UnitClass;
  flags: string;
}

export interface GameEvent {
  type: 'kill' | 'hit' | 'score_update';
  src: number;
  dst?: number;
  ts: string;
  hp?: number;
  srcName?: string;
  dstName?: string;
  srcClass?: string;
  dstClass?: string;
}

export interface Frame {
  type: 'frame';
  ts: string;
  units: UnitPosition[];
  events: GameEvent[];
  pois?: POIObject[];
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

export async function fetchUnitClasses(gameId: string): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/games/${gameId}/unitclasses`);
  return res.json();
}

export async function saveUnitClasses(gameId: string, classes: Record<string, string>): Promise<Record<string, string>> {
  const res = await fetch(`${BASE}/api/games/${gameId}/unitclasses`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(classes),
  });
  return res.json();
}
