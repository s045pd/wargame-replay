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
  type: 'kill' | 'hit' | 'revive' | 'heal' | 'score_update';
  src: number;
  dst?: number;
  ts: string;
  hp?: number;
  srcName?: string;
  dstName?: string;
  srcClass?: string;
  dstClass?: string;
}

export interface HotspotEvent {
  id: number;
  type: 'firefight' | 'killstreak' | 'mass_casualty' | 'engagement' | 'bombardment';
  startTs: string;
  endTs: string;
  peakTs: string;
  centerLat: number;
  centerLng: number;
  radius: number;
  score: number;
  label: string;
  kills: number;
  hits: number;
  units?: number[];
  focusUnitId?: number;
  focusName?: string;
}

export interface Frame {
  type: 'frame';
  ts: string;
  units: UnitPosition[];
  events: GameEvent[];
  pois?: POIObject[];
  hotspots?: HotspotEvent[];
}

/** Result of a single file in a multi-file upload. */
export interface UploadFileResult {
  filename: string;
  status: 'ok' | 'error';
  message?: string;
  game?: GameInfo;
}

/** Upload multiple .db and .txt files. Returns per-file results. */
export async function uploadFiles(files: File[]): Promise<UploadFileResult[]> {
  const form = new FormData();
  for (const f of files) {
    form.append('files', f);
  }
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.detail || err.error || 'Upload failed');
  }
  const data = await res.json();
  // Handle legacy single-file response (returns GameInfo directly)
  if (data.results) return data.results;
  // Legacy: single game returned
  return [{ filename: files[0]?.name ?? '', status: 'ok', game: data }];
}

/** Upload a single .db game file (legacy helper). */
export async function uploadGame(file: File): Promise<GameInfo> {
  const results = await uploadFiles([file]);
  const ok = results.find(r => r.status === 'ok' && r.game);
  if (ok?.game) return ok.game;
  const err = results.find(r => r.status === 'error');
  throw new Error(err?.message || 'Upload failed');
}

/** Delete a game by ID. */
export async function deleteGame(gameId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/games/${gameId}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Delete failed');
  }
}

export async function fetchGames(): Promise<GameInfo[]> {
  const res = await fetch(`${BASE}/api/games`);
  return res.json();
}

export async function fetchMeta(gameId: string): Promise<GameMeta> {
  const res = await fetch(`${BASE}/api/games/${gameId}/meta`);
  return res.json();
}

/** Fetch ALL hotspot events for the entire game (pre-computed on server). */
export async function fetchHotspots(gameId: string): Promise<HotspotEvent[]> {
  const res = await fetch(`${BASE}/api/games/${gameId}/hotspots`);
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
