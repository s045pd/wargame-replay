// ── Binary protocol decoder ported from Go decoder/position.go + event.go ──

import type { UnitPosition, GameEvent, POIObject, BombingEvent, BaseCamp, Minefield } from './types';
import type { CoordResolver } from './coords';
import type { Database } from 'sql.js';

const ENTRY_SIZE = 15;
const DT8_ENTRY_SIZE = 31;

// ── Position decoding (DataType=1, 15 bytes/unit) ──

function decodeTeam(unitID: number): 'red' | 'blue' {
  return unitID < 500 ? 'red' : 'blue';
}

function decodeClass(flags: Uint8Array): string {
  if (flags.length >= 2) {
    switch (flags[1]! & 0x07) {
      case 1: return 'mg';
      case 2: return 'marksman';
      case 3: return 'sniper';
      case 4: return 'medic';
    }
  }
  return 'rifle';
}

export function decodePositionEntry(data: Uint8Array, offset: number): UnitPosition | null {
  if (offset + ENTRY_SIZE > data.length) return null;
  const view = new DataView(data.buffer, data.byteOffset + offset, ENTRY_SIZE);

  const unitID = view.getUint16(0, true);
  const rawLat = view.getUint32(2, true);
  const rawLng = view.getUint32(6, true);
  const flags = new Uint8Array(data.buffer, data.byteOffset + offset + 10, 5);

  const hp = flags[0]!;
  const alive = hp > 0;
  const flagsHex = Array.from(flags).map(b => b.toString(16).padStart(2, '0')).join('');

  return {
    id: unitID,
    rawLat,
    rawLng,
    lat: 0,
    lng: 0,
    x: 0,
    y: 0,
    team: decodeTeam(unitID),
    alive,
    hp,
    ammo: flags[2]!,
    supply: (flags[1]! >> 3) & 0x1F,
    bandage: flags[3]!,
    revivalTokens: flags[4]!,
    name: '',
    class: decodeClass(flags),
    flags: flagsHex,
  };
}

export function decodePositionFrame(data: Uint8Array): UnitPosition[] {
  const count = Math.floor(data.length / ENTRY_SIZE);
  const units: UnitPosition[] = [];
  for (let i = 0; i < count; i++) {
    const u = decodePositionEntry(data, i * ENTRY_SIZE);
    if (u) units.push(u);
  }
  return units;
}

// ── POI decoding (DataType=8, 31 bytes/entry) ──

export function decodeDT8POIs(data: Uint8Array): POIObject[] {
  const count = Math.floor(data.length / DT8_ENTRY_SIZE);
  const pois: POIObject[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * DT8_ENTRY_SIZE;
    if (off + DT8_ENTRY_SIZE > data.length) break;
    const view = new DataView(data.buffer, data.byteOffset + off, DT8_ENTRY_SIZE);
    const rawLat = view.getUint32(3, true);
    const rawLng = view.getUint32(7, true);
    if (rawLat === 0 && rawLng === 0) continue;
    const poiType = data[off + 11]!;
    if (poiType < 1 || poiType > 5) continue;
    pois.push({
      id: data[off]!,
      type: poiType,
      team: data[off + 12]!,
      resource: data[off + 13]!,
      lat: rawLat, // raw coords, caller must convert
      lng: rawLng,
    });
  }
  return pois;
}

// ── Event decoding (DataType=2, hit/kill/revive/heal) ──

export function loadHitEvents(db: Database): GameEvent[] {
  const events: GameEvent[] = [];
  const stmt = db.prepare(`
    SELECT SrcIndex, LogTime, LogData FROM record
    WHERE SrcType=1 AND DataType=2 AND LogData IS NOT NULL AND length(LogData) >= 2
    ORDER BY LogTime
  `);

  while (stmt.step()) {
    const row = stmt.get();
    const victimID = row[0] as number;
    const ts = row[1] as string;
    const blob = row[2] as Uint8Array;
    if (!blob || blob.length < 2) continue;

    const eventType = blob[0]!;
    const hp = blob[1]!;

    switch (eventType) {
      case 0x01: {
        if (blob.length < 4) continue;
        const shooterID = new DataView(blob.buffer, blob.byteOffset + 2, 2).getUint16(0, true);
        events.push({
          type: hp === 0 ? 'kill' : 'hit',
          ts,
          src: shooterID,
          dst: victimID,
          hp,
        });
        break;
      }
      case 0x41: {
        const reviveHP = hp === 0 ? 100 : hp;
        events.push({
          type: 'revive',
          ts,
          src: victimID,
          dst: victimID,
          hp: reviveHP,
        });
        break;
      }
      case 0x40: {
        events.push({
          type: 'heal',
          ts,
          src: victimID,
          dst: victimID,
          hp,
        });
        break;
      }
    }
  }
  stmt.free();
  return events;
}

// ── Bombing events (DataType=11) ──

export function loadBombingEvents(db: Database): BombingEvent[] {
  const events: BombingEvent[] = [];
  const stmt = db.prepare(`
    SELECT LocLat, LocLng, LogTime, LogData FROM record
    WHERE DataType=11 AND LogData IS NOT NULL
    ORDER BY LogTime
  `);

  while (stmt.step()) {
    const row = stmt.get();
    const rawLat = row[0] as number;
    const rawLng = row[1] as number;
    const ts = row[2] as string;
    const blob = row[3] as Uint8Array;

    const ev: BombingEvent = { ts, rawLat, rawLng, lat: 0, lng: 0, param: 0, evType: 0, subType: 0 };
    if (blob && blob.length >= 4) {
      ev.param = blob[0]!;
      ev.evType = blob[2]!;
      ev.subType = blob[3]!;
    }
    events.push(ev);
  }
  stmt.free();
  return events;
}

// ── Minefield zone polygons (SrcType=64, DataType=1, 37 bytes/entry) ──

export function loadMinefields(db: Database, resolver: CoordResolver): Minefield[] {
  const stmt = db.prepare(`
    SELECT LogData FROM record
    WHERE SrcType=64 AND DataType=1 AND LogData IS NOT NULL
    ORDER BY length(LogData) DESC LIMIT 1
  `);
  if (!stmt.step()) { stmt.free(); return []; }
  const blob = stmt.get()[0] as Uint8Array;
  stmt.free();
  if (!blob || blob.length < 37) return [];

  const ENTRY_LEN = 37;
  const COORD_OFF = 5;
  const count = Math.floor(blob.length / ENTRY_LEN);
  const zones: Minefield[] = [];

  for (let i = 0; i < count; i++) {
    const off = i * ENTRY_LEN;
    const corners: [number, number][] = [];
    let valid = true;
    for (let c = 0; c < 4; c++) {
      const co = off + COORD_OFF + c * 8;
      const rawLat = blob[co]! | (blob[co + 1]! << 8) | (blob[co + 2]! << 16) | ((blob[co + 3]! << 24) >>> 0);
      const rawLng = blob[co + 4]! | (blob[co + 5]! << 8) | (blob[co + 6]! << 16) | ((blob[co + 7]! << 24) >>> 0);
      if (rawLat === 0 && rawLng === 0) { valid = false; break; }
      const [lat, lng] = resolver.convert(rawLat, rawLng);
      corners.push([lat, lng]);
    }
    if (!valid) continue;
    zones.push({ id: blob[off]! & 0x7F, corners });
  }
  return zones;
}

// ── Base camps (earliest position centroid per team) ──

export function computeBaseCamps(db: Database, resolver: CoordResolver): BaseCamp[] {
  const firstTsStmt = db.prepare(`SELECT MIN(LogTime) FROM record WHERE SrcType=1 AND DataType=1`);
  if (!firstTsStmt.step()) { firstTsStmt.free(); return []; }
  const firstTs = firstTsStmt.get()[0] as string;
  firstTsStmt.free();
  if (!firstTs) return [];

  const stmt = db.prepare(`
    SELECT LogData FROM record
    WHERE SrcType=1 AND DataType=1
      AND LogTime >= ? AND LogTime <= datetime(?, '+10 seconds')
    ORDER BY LogTime ASC
  `);
  stmt.bind([firstTs, firstTs]);

  const teams: Record<string, { sumLat: number; sumLng: number; count: number }> = {
    red: { sumLat: 0, sumLng: 0, count: 0 },
    blue: { sumLat: 0, sumLng: 0, count: 0 },
  };
  const seen = new Set<number>();

  while (stmt.step()) {
    const blob = stmt.get()[0] as Uint8Array;
    if (!blob) continue;
    for (const u of decodePositionFrame(blob)) {
      if (u.rawLat === 0 && u.rawLng === 0) continue;
      if (seen.has(u.id)) continue;
      seen.add(u.id);
      const [lat, lng] = resolver.convert(u.rawLat, u.rawLng);
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      const acc = teams[u.team];
      if (acc) { acc.sumLat += lat; acc.sumLng += lng; acc.count++; }
    }
  }
  stmt.free();

  const camps: BaseCamp[] = [];
  for (const [team, acc] of Object.entries(teams)) {
    if (acc.count > 0) {
      camps.push({ team, lat: acc.sumLat / acc.count, lng: acc.sumLng / acc.count });
    }
  }
  return camps;
}

// ── Score updates (DataType=5) ──

export function loadScoreUpdates(db: Database): GameEvent[] {
  const events: GameEvent[] = [];
  const stmt = db.prepare(`
    SELECT LogTime, LogData FROM record
    WHERE SrcType=64 AND DataType=5 AND LogData IS NOT NULL
    ORDER BY LogTime
  `);

  while (stmt.step()) {
    const row = stmt.get();
    const ts = row[0] as string;
    const blob = row[1] as Uint8Array;
    if (!blob || blob.length < 8) continue;
    const view = new DataView(blob.buffer, blob.byteOffset, 8);
    events.push({
      type: 'score_update',
      ts,
      src: view.getUint32(0, true),
      dst: view.getUint32(4, true),
      hp: 0,
    });
  }
  stmt.free();
  return events;
}

// ── Player roster (tag table) ──

export function loadPlayers(db: Database): Map<number, string> {
  const players = new Map<number, string>();
  const stmt = db.prepare(`SELECT SrcIndex, TagText FROM tag WHERE SrcType=1 AND TagText <> '' GROUP BY SrcIndex`);
  while (stmt.step()) {
    const row = stmt.get();
    players.set(row[0] as number, row[1] as string);
  }
  stmt.free();
  return players;
}
