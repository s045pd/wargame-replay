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
  type: number; // 1=base camp, 2=兵站(supply station), 3=supply cache, 4=control point, 5=station
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
  ammo: number;
  supply: number;
  revivalTokens: number;
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
  type: 'firefight' | 'killstreak' | 'mass_casualty' | 'engagement' | 'bombardment' | 'long_range';
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
  distance?: number;
  srcLat?: number;
  srcLng?: number;
  dstLat?: number;
  dstLng?: number;
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

/** Fetch ALL kill events for the entire game, sorted by timestamp. */
export async function fetchKills(gameId: string): Promise<GameEvent[]> {
  try {
    const res = await fetch(`${BASE}/api/games/${gameId}/kills`);
    if (!res.ok) return [];
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return [];
    return await res.json();
  } catch {
    return [];
  }
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

// ─── Video Sync ─────────────────────────────────────────────────────────────

export interface VideoSegment {
  /**
   * Absolute path on the server's filesystem. The JSON field is still
   * named `relPath` because sidecar files written by earlier versions
   * use that name; the semantic is now "whatever path the scanner
   * currently considers the canonical key for this file".
   */
  relPath: string;
  startTs: string;
  durationMs: number;
  codec: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  fileMTime: string;
  compatible: boolean;
  /** True when the file is missing or modified since association. */
  stale?: boolean;
}

export interface VideoGroup {
  id: string;
  unitId: number;
  cameraLabel: string;
  offsetMs: number; // gameMs = videoMs + offsetMs
  segments: VideoSegment[];
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface CandidateGroup {
  autoGroupKey: string;
  segments: VideoSegment[];
  totalDurationMs: number;
  codec: string;
  compatible: boolean;
}

export interface VideoStatus {
  /** True when the server has the scanner object wired up. */
  ready: boolean;
  /** True when at least one source directory is registered. */
  enabled: boolean;
  sources: string[];
  segmentCount: number;
  lastScanAt: string;
  scanning: boolean;
}

export interface VideoSource {
  path: string;
  segmentCount: number;
  exists: boolean;
}

export interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
  videoCount?: number;
}

export interface BrowseResponse {
  path: string;
  parent: string;
  entries: BrowseEntry[];
}

export interface QuickAddPayload {
  unitId: number;
  cameraLabel: string;
  directory: string;
}

export interface QuickAddResponse {
  group: VideoGroup;
  source: string;
}

export interface CreateVideoGroupPayload {
  unitId: number;
  cameraLabel: string;
  offsetMs: number;
  segmentRelPaths: string[];
  notes?: string;
}

export type UpdateVideoGroupPayload = Partial<{
  unitId: number;
  cameraLabel: string;
  offsetMs: number;
  notes: string;
  segmentRelPaths: string[];
}>;

export async function fetchVideoStatus(): Promise<VideoStatus> {
  const res = await fetch(`${BASE}/api/videos/status`);
  if (!res.ok) {
    return {
      ready: false,
      enabled: false,
      sources: [],
      segmentCount: 0,
      lastScanAt: '',
      scanning: false,
    };
  }
  const data = await res.json();
  return {
    ready: Boolean(data.ready),
    enabled: Boolean(data.enabled),
    sources: Array.isArray(data.sources) ? data.sources : [],
    segmentCount: Number(data.segmentCount ?? 0),
    lastScanAt: String(data.lastScanAt ?? ''),
    scanning: Boolean(data.scanning),
  };
}

export async function fetchVideoSources(): Promise<VideoSource[]> {
  const res = await fetch(`${BASE}/api/videos/sources`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.sources ?? []) as VideoSource[];
}

export async function addVideoSource(path: string): Promise<string> {
  const res = await fetch(`${BASE}/api/videos/sources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Add video source failed');
  }
  const data = await res.json();
  return String(data.path);
}

export async function deleteVideoSource(path: string): Promise<void> {
  const res = await fetch(
    `${BASE}/api/videos/sources?path=${encodeURIComponent(path)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Delete video source failed');
  }
}

export async function browseDirectory(path: string): Promise<BrowseResponse> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`${BASE}/api/videos/browse${qs}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Browse directory failed');
  }
  return res.json();
}

export async function quickAddVideoSource(
  gameId: string,
  payload: QuickAddPayload,
): Promise<QuickAddResponse> {
  const res = await fetch(`${BASE}/api/games/${gameId}/videos/quick-add`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Quick add failed');
  }
  return res.json();
}

export async function fetchVideoLibrary(): Promise<VideoSegment[]> {
  const res = await fetch(`${BASE}/api/videos/library`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.segments ?? [];
}

export async function rescanVideos(): Promise<VideoStatus> {
  const res = await fetch(`${BASE}/api/videos/rescan`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Rescan failed');
  }
  const data = await res.json();
  return {
    ready: Boolean(data.ready),
    enabled: Boolean(data.enabled),
    sources: Array.isArray(data.sources) ? data.sources : [],
    segmentCount: Number(data.segmentCount ?? 0),
    lastScanAt: String(data.lastScanAt ?? ''),
    scanning: Boolean(data.scanning),
  };
}

export async function fetchVideoCandidates(gameId: string): Promise<CandidateGroup[]> {
  const res = await fetch(`${BASE}/api/games/${gameId}/videos/candidates`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.candidates ?? [];
}

export async function fetchVideoGroups(gameId: string): Promise<VideoGroup[]> {
  const res = await fetch(`${BASE}/api/games/${gameId}/videos`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.groups ?? [];
}

export async function createVideoGroup(gameId: string, payload: CreateVideoGroupPayload): Promise<VideoGroup> {
  const res = await fetch(`${BASE}/api/games/${gameId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Create video group failed');
  }
  return res.json();
}

export async function updateVideoGroup(
  gameId: string,
  groupId: string,
  patch: UpdateVideoGroupPayload,
): Promise<VideoGroup> {
  const res = await fetch(`${BASE}/api/games/${gameId}/videos/${groupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Update video group failed');
  }
  return res.json();
}

export async function deleteVideoGroup(gameId: string, groupId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/games/${gameId}/videos/${groupId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Delete video group failed');
  }
}

/**
 * Build a streaming URL for a video segment. The backend expects a
 * URL-safe base64 (no padding) of the segment's absolute path, so that
 * slashes inside the path do not collide with Gin route parameters.
 */
export function videoStreamUrl(absPath: string): string {
  return `${BASE}/api/video-stream/${base64UrlEncode(absPath)}`;
}

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
