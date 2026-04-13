// ── Data types ported from Go decoder/types.go + game/service.go + hotspot/engine.go ──

export type UnitClass = 'rifle' | 'mg' | 'medic' | 'marksman' | 'sniper';

export interface UnitPosition {
  id: number;
  rawLat: number;
  rawLng: number;
  lat: number;
  lng: number;
  x: number;
  y: number;
  team: 'red' | 'blue';
  alive: boolean;
  hp: number;
  ammo: number;
  supply: number;
  bandage: number;
  revivalTokens: number;
  name: string;
  class: string;
  flags: string;
}

export interface GameEvent {
  type: 'kill' | 'hit' | 'revive' | 'heal' | 'score_update';
  src: number;
  dst: number;
  ts: string;
  detail?: string;
  hp: number;
  srcName?: string;
  dstName?: string;
  srcClass?: string;
  dstClass?: string;
}

export interface POIObject {
  id: number;
  type: number; // 1=base, 2=vehicle, 3=supply, 4=control, 5=station
  team: number; // 0=red, 1=blue, 2=neutral
  resource: number;
  lat: number;
  lng: number;
}

export interface BombingEvent {
  ts: string;
  rawLat: number;
  rawLng: number;
  lat: number;
  lng: number;
  param: number;
  evType: number;
  subType: number;
}

export interface BaseCamp {
  team: string;
  lat: number;
  lng: number;
}

export type CoordMode = 'wgs84' | 'relative';

export interface MapMeta {
  OK: boolean;
  CenterOK: boolean;
  CenterLat: number;
  CenterLng: number;
  MaxNativeZoom: number;
  GratCR: number;
  GratLatBegin: number;
  GratLatSpace: number;
  GratLngBegin: number;
  GratLngSpace: number;
}

export interface Graticule {
  latBegin: number;
  latSpace: number;
  lngBegin: number;
  lngSpace: number;
  cr: number;
}

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  team: string;
}

export interface GameMeta {
  coordMode: CoordMode;
  startTime: string;
  endTime: string;
  players: PlayerInfo[];
  centerLat?: number;
  centerLng?: number;
  bounds?: Bounds;
  baseCamps?: BaseCamp[];
  graticule?: Graticule;
  bombingEvents?: BombingEvent[];
  minefields?: Minefield[];
}

export interface Minefield {
  id: number;
  corners: [number, number][]; // [[lat, lng], ...]
}

export interface Frame {
  type: 'frame';
  ts: string;
  units: UnitPosition[];
  events: GameEvent[];
  hotspots: HotspotEvent[];
  pois: POIObject[];
}

export interface HotspotEvent {
  id: number;
  type: string; // firefight, killstreak, mass_casualty, engagement, bombardment, long_range
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

// ── Worker protocol ──

export type WorkerRequest =
  | { type: 'init'; dbBuffer: ArrayBuffer; txtContent?: string; wasmUrl: string }
  | { type: 'getFrame'; ts: string }
  | { type: 'getFrameRange'; fromTs: string; ts: string };

export type WorkerResponse =
  | { type: 'ready'; meta: GameMeta; hotspots: HotspotEvent[]; allKills: GameEvent[]; timestamps: string[] }
  | { type: 'frame'; frame: Frame }
  | { type: 'error'; message: string }
  | { type: 'progress'; stage: string; percent: number };
