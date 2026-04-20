// ── Frame assembly service ported from Go game/service.go ──

import type { Database } from 'sql.js';
import type {
  GameMeta, Frame, UnitPosition, GameEvent, HotspotEvent, POIObject,
  PlayerInfo, Bounds,
} from './types';
import type { CoordResolver } from './coords';
import { autoDetectCoords, parseMapMeta } from './coords';
import { TimeIndex } from './timeindex';
import {
  decodePositionFrame, decodeDT8POIs, loadHitEvents,
  loadBombingEvents, loadMinefields, computeBaseCamps, loadPlayers,
} from './decoder';
import { detectHotspotEvents } from './hotspot';

interface HpEntry { ts: string; hp: number }

const ACCUM_WINDOW = 7;
const FALLBACK_WINDOW = 120;

export class GameService {
  private db: Database;
  private idx: TimeIndex;
  private resolver: CoordResolver;
  private players: Map<number, string>;
  private _meta: GameMeta;
  private _hotspots: HotspotEvent[];
  private _allKills: GameEvent[];

  // HP timeline per unit: sorted by timestamp ascending
  private hpTimeline: Map<number, HpEntry[]> = new Map();
  // Hit events indexed by timestamp
  private hitEventsByTs: Map<string, GameEvent[]> = new Map();
  // Sorted unique event timestamps (for binary search)
  private hitTimestamps: string[] = [];

  // Frame cache (simple LRU-ish map with size limit)
  private frameCache: Map<string, Frame> = new Map();
  private readonly CACHE_MAX = 500;

  private constructor(
    db: Database, idx: TimeIndex, resolver: CoordResolver,
    players: Map<number, string>, meta: GameMeta,
    hotspots: HotspotEvent[], allKills: GameEvent[],
  ) {
    this.db = db;
    this.idx = idx;
    this.resolver = resolver;
    this.players = players;
    this._meta = meta;
    this._hotspots = hotspots;
    this._allKills = allKills;
  }

  static load(
    db: Database,
    txtContent?: string,
    onProgress?: (stage: string, percent: number) => void,
  ): GameService {
    onProgress?.('Building time index...', 5);
    const idx = TimeIndex.build(db);

    onProgress?.('Detecting coordinates...', 15);
    const [resolver, coordMode] = autoDetectCoords(db, txtContent);

    onProgress?.('Loading players...', 20);
    const players = loadPlayers(db);

    const meta: GameMeta = {
      coordMode,
      startTime: idx.startTime(),
      endTime: idx.endTime(),
      players: buildPlayerList(players),
    };

    // .txt sidecar metadata
    if (txtContent) {
      const mapMeta = parseMapMeta(txtContent);
      if (mapMeta) {
        meta.centerLat = mapMeta.CenterLat;
        meta.centerLng = mapMeta.CenterLng;
        if (mapMeta.GratLatSpace > 0 && mapMeta.GratLngSpace > 0) {
          meta.graticule = {
            latBegin: mapMeta.GratLatBegin,
            latSpace: mapMeta.GratLatSpace,
            lngBegin: mapMeta.GratLngBegin,
            lngSpace: mapMeta.GratLngSpace,
            cr: mapMeta.GratCR,
          };
        }
      }
    }

    // WGS84 bounds
    if (resolver.mode() === 'wgs84') {
      onProgress?.('Computing bounds...', 25);
      const bounds = computeWGS84Bounds(db, resolver);
      if (bounds) meta.bounds = bounds;

      const camps = computeBaseCamps(db, resolver);
      if (camps.length) meta.baseCamps = camps;
    }

    // Bombing events
    onProgress?.('Loading bombing events...', 30);
    const bombEvents = loadBombingEvents(db);
    for (const ev of bombEvents) {
      [ev.lat, ev.lng] = resolver.convert(ev.rawLat, ev.rawLng);
    }
    if (bombEvents.length) meta.bombingEvents = bombEvents;

    // Minefield zones
    const minefields = loadMinefields(db, resolver);
    if (minefields.length) meta.minefields = minefields;

    // Hit events + HP timeline
    onProgress?.('Loading combat events...', 40);
    const hitEvents = loadHitEvents(db);

    const svc = new GameService(db, idx, resolver, players, meta, [], []);

    // Deduplicate events
    const seen = new Set<string>();
    for (const ev of hitEvents) {
      const key = `${ev.type}|${ev.src}|${ev.dst}|${ev.ts}|${ev.hp}`;
      if (seen.has(key)) continue;
      seen.add(key);

      ev.srcName = players.get(ev.src);
      ev.dstName = players.get(ev.dst);

      const list = svc.hitEventsByTs.get(ev.ts);
      if (list) list.push(ev);
      else svc.hitEventsByTs.set(ev.ts, [ev]);

      // HP timeline
      const timeline = svc.hpTimeline.get(ev.dst);
      if (timeline) timeline.push({ ts: ev.ts, hp: ev.hp });
      else svc.hpTimeline.set(ev.dst, [{ ts: ev.ts, hp: ev.hp }]);
    }

    // Sort HP timelines
    for (const timeline of svc.hpTimeline.values()) {
      timeline.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
    }

    // Build sorted event timestamps
    svc.hitTimestamps = [...svc.hitEventsByTs.keys()].sort();

    // Collect all combat events (kill + hit + heal + revive) for per-unit
    // personal-event filtering and leaderboard counts. Consumers that only
    // care about kills filter by ev.type === 'kill' themselves.
    const allKills: GameEvent[] = [];
    for (const ts of svc.hitTimestamps) {
      for (const ev of svc.hitEventsByTs.get(ts)!) {
        if (ev.type === 'kill' || ev.type === 'hit' || ev.type === 'heal' || ev.type === 'revive') {
          allKills.push(ev);
        }
      }
    }
    svc._allKills = allKills;

    // Hotspot detection
    onProgress?.('Detecting hotspots...', 60);
    const combatEvents = hitEvents.filter(e => e.type === 'hit' || e.type === 'kill');
    const hotspots = detectHotspotEvents(db, resolver, combatEvents, bombEvents);
    // Populate focus names
    for (const h of hotspots) {
      if (h.focusUnitId) {
        h.focusName = players.get(h.focusUnitId);
      }
    }
    svc._hotspots = hotspots;

    onProgress?.('Ready', 100);
    return svc;
  }

  get meta(): GameMeta { return this._meta; }
  get hotspots(): HotspotEvent[] { return this._hotspots; }
  get allKills(): GameEvent[] { return this._allKills; }
  get timeIndex(): TimeIndex { return this.idx; }

  /** Get a frame at timestamp ts. */
  getFrame(ts: string): Frame | null {
    // Cache check
    const cached = this.frameCache.get(ts);
    if (cached) return cached;

    const unitMap = new Map<number, UnitPosition>();
    let actualTs = '';

    // Primary window: [ts - ACCUM_WINDOW, ts]
    const stmt = this.db.prepare(`
      SELECT LogTime, LogData FROM record
      WHERE SrcType=1 AND DataType=1
        AND LogTime >= datetime(?, '-${ACCUM_WINDOW} seconds')
        AND LogTime <= ?
      ORDER BY LogTime ASC
    `);
    stmt.bind([ts, ts]);

    while (stmt.step()) {
      const row = stmt.get();
      const rowTs = row[0] as string;
      const blob = row[1] as Uint8Array;
      if (!blob) continue;
      actualTs = rowTs;
      for (const u of decodePositionFrame(blob)) {
        if (!this.players.has(u.id)) continue;
        unitMap.set(u.id, u);
      }
    }
    stmt.free();

    // Fallback window for missing units
    if (unitMap.size < this.players.size) {
      const missing = new Set<number>();
      for (const id of this.players.keys()) {
        if (!unitMap.has(id)) missing.add(id);
      }
      if (missing.size > 0) {
        const fbStmt = this.db.prepare(`
          SELECT LogData FROM record
          WHERE SrcType=1 AND DataType=1
            AND LogTime >= datetime(?, '-${FALLBACK_WINDOW} seconds')
            AND LogTime < datetime(?, '-${ACCUM_WINDOW} seconds')
          ORDER BY LogTime DESC
        `);
        fbStmt.bind([ts, ts]);
        while (fbStmt.step() && missing.size > 0) {
          const blob = fbStmt.get()[0] as Uint8Array;
          if (!blob) continue;
          for (const u of decodePositionFrame(blob)) {
            if (missing.has(u.id) && this.players.has(u.id)) {
              unitMap.set(u.id, u);
              missing.delete(u.id);
            }
          }
        }
        fbStmt.free();
      }
    }

    // POIs
    const pois: POIObject[] = [];
    const poiStmt = this.db.prepare(`
      SELECT LogData FROM record
      WHERE SrcType=64 AND DataType=8
        AND LogTime >= datetime(?, '-1 seconds') AND LogTime <= ?
      ORDER BY LogTime DESC LIMIT 1
    `);
    poiStmt.bind([ts, ts]);
    if (poiStmt.step()) {
      const blob = poiStmt.get()[0] as Uint8Array;
      if (blob) {
        for (const poi of decodeDT8POIs(blob)) {
          const [lat, lng] = this.resolver.convert(poi.lat, poi.lng);
          poi.lat = lat;
          poi.lng = lng;
          pois.push(poi);
        }
      }
    }
    poiStmt.free();

    if (!actualTs) actualTs = ts;

    // Convert units: resolve coords, attach names, reconcile HP
    const units: UnitPosition[] = [];
    for (const u of unitMap.values()) {
      const [lat, lng] = this.resolver.convert(u.rawLat, u.rawLng);
      if (this.resolver.mode() === 'wgs84') {
        u.lat = lat; u.lng = lng;
      } else {
        u.x = lat; u.y = lng;
      }
      u.name = this.players.get(u.id) ?? '';

      // HP reconciliation via binary search
      const timeline = this.hpTimeline.get(u.id);
      if (timeline && timeline.length > 0) {
        let lo = 0, hi = timeline.length - 1, bestIdx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >>> 1;
          if (timeline[mid]!.ts <= actualTs) { bestIdx = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        if (bestIdx >= 0) {
          const eventHP = timeline[bestIdx]!.hp;
          if (u.alive) {
            if (eventHP > 0) u.hp = eventHP;
            // else: event HP=0 but alive → revived, keep HP=100
          } else {
            u.hp = 0;
          }
        }
      }

      units.push(u);
    }

    const events = this.collectEvents(actualTs, ts);

    const frame: Frame = {
      type: 'frame',
      ts: actualTs,
      units,
      events,
      hotspots: this.activeHotspots(actualTs),
      pois,
    };

    // Cache
    if (this.frameCache.size >= this.CACHE_MAX) {
      const firstKey = this.frameCache.keys().next().value;
      if (firstKey !== undefined) this.frameCache.delete(firstKey);
    }
    this.frameCache.set(ts, frame);

    return frame;
  }

  /** Get frame at ts, collecting events from fromTs..ts (for fast-forward). */
  getFrameRange(fromTs: string, ts: string): Frame | null {
    const frame = this.getFrame(ts);
    if (!frame) return null;
    if (!fromTs || fromTs >= frame.ts) return frame;
    // Re-collect events over wider range (exclusive lower bound)
    frame.events = this.collectEventsAfter(fromTs, ts);
    return frame;
  }

  /** Active hotspots at timestamp. */
  private activeHotspots(ts: string): HotspotEvent[] {
    return this._hotspots.filter(h => ts >= h.startTs && ts <= h.endTs);
  }

  /** Collect events with fromTs <= ts <= toTs. */
  private collectEvents(fromTs: string, toTs: string): GameEvent[] {
    const result: GameEvent[] = [];
    let startIdx = this.bisect(fromTs);
    for (let i = startIdx; i < this.hitTimestamps.length; i++) {
      const t = this.hitTimestamps[i]!;
      if (t > toTs) break;
      result.push(...this.hitEventsByTs.get(t)!);
    }
    return result;
  }

  /** Collect events with fromTs < ts <= toTs (exclusive lower). */
  private collectEventsAfter(fromTs: string, toTs: string): GameEvent[] {
    const result: GameEvent[] = [];
    let startIdx = this.bisect(fromTs);
    for (let i = startIdx; i < this.hitTimestamps.length; i++) {
      const t = this.hitTimestamps[i]!;
      if (t > toTs) break;
      if (t === fromTs) continue;
      result.push(...this.hitEventsByTs.get(t)!);
    }
    return result;
  }

  /** Binary search for first index >= target. */
  private bisect(target: string): number {
    let lo = 0, hi = this.hitTimestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.hitTimestamps[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

// ── Helpers ──

function buildPlayerList(players: Map<number, string>): PlayerInfo[] {
  const list: PlayerInfo[] = [];
  for (const [id, name] of players) {
    list.push({ id, name, team: id < 500 ? 'red' : 'blue' });
  }
  return list;
}

function computeWGS84Bounds(db: Database, resolver: CoordResolver): Bounds | null {
  const stmt = db.prepare(`SELECT LogData FROM record WHERE SrcType=1 AND DataType=1 AND LogData IS NOT NULL`);
  let minLat = 999, minLng = 999, maxLat = -999, maxLng = -999;
  let count = 0;

  while (stmt.step()) {
    const blob = stmt.get()[0] as Uint8Array;
    if (!blob) continue;
    for (const u of decodePositionFrame(blob)) {
      if (u.rawLat === 0 && u.rawLng === 0) continue;
      const [lat, lng] = resolver.convert(u.rawLat, u.rawLng);
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      count++;
    }
  }
  stmt.free();

  return count > 0 ? { minLat, maxLat, minLng, maxLng } : null;
}
