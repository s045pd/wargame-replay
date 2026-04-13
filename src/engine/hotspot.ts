// ── Hotspot detection engine ported from Go hotspot/engine.go ──

import type { Database } from 'sql.js';
import type { GameEvent, BombingEvent, HotspotEvent } from './types';
import type { CoordResolver } from './coords';
import { decodePositionFrame } from './decoder';

// ── Tuning constants ──
const CLUSTER_GAP_SEC = 45;
const MAX_CLUSTER_SEC = 180;
const MIN_CLUSTER_SCORE = 15;
const MIN_KILLS_FIREFIGHT = 2;
const MIN_STREAK_KILLS = 4;
const MIN_KILLS_ENGAGE = 3;
const MAX_STREAK_GAP_SEC = 60;
const LONG_RANGE_MAX_M = 600;
const LONG_RANGE_MIN_M = 250;
const LONG_RANGE_STEP = 50;
const LONG_RANGE_TOP_N = 3;
const MAX_POS_AGE_SEC = 10;
const DEDUP_DIST_M = 200;
const DEDUP_OVERLAP_SEC = 30;

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T') + 'Z').getTime();
}

function addSecondsToTs(ts: string, sec: number): string {
  const ms = parseTs(ts);
  if (isNaN(ms)) return ts;
  const d = new Date(ms + sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Public API ──

export function detectHotspotEvents(
  db: Database,
  resolver: CoordResolver,
  combatEvents: GameEvent[],
  bombingEvents: BombingEvent[],
): HotspotEvent[] {
  // Filter to hit/kill only
  const combat = combatEvents.filter(e => e.type === 'hit' || e.type === 'kill');

  // Phase 1: temporal clustering
  const clusters = temporalCluster(combat);

  let hotspots: HotspotEvent[] = [];

  // Phase 2: extract killstreaks from full clusters, then split for other types
  for (const cl of clusters) {
    const ksHotspots = extractKillstreaks(cl);
    for (const ks of ksHotspots) {
      if (ks.score < MIN_CLUSTER_SCORE) continue;
      const [cLat, cLng, r] = lookupSpatialInfo(db, resolver, ks.startTs, ks.endTs, ks.units ?? []);
      ks.centerLat = cLat; ks.centerLng = cLng; ks.radius = r;
      hotspots.push(ks);
    }

    for (const subcl of splitLongCluster(cl, MAX_CLUSTER_SEC)) {
      const h = analyseCluster(subcl);
      if (h.score < MIN_CLUSTER_SCORE || h.type === 'killstreak') continue;
      const [cLat, cLng, r] = lookupSpatialInfo(db, resolver, h.startTs, h.endTs, h.units ?? []);
      h.centerLat = cLat; h.centerLng = cLng; h.radius = r;
      hotspots.push(h);
    }
  }

  // Long-range kills
  hotspots.push(...detectLongRangeKills(db, resolver, combat));

  // Bombing events
  for (const bev of bombingEvents) {
    if (bev.lat === 0 && bev.lng === 0) continue;
    hotspots.push({
      id: 0, type: 'bombardment',
      startTs: addSecondsToTs(bev.ts, -5),
      endTs: addSecondsToTs(bev.ts, 20),
      peakTs: bev.ts,
      centerLat: bev.lat, centerLng: bev.lng,
      radius: 300, score: 12,
      label: '轰炸/空袭', kills: 0, hits: 0,
    });
  }

  // Deduplicate
  hotspots = deduplicateHotspots(hotspots);

  // Sort and assign IDs
  hotspots.sort((a, b) => a.startTs < b.startTs ? -1 : a.startTs > b.startTs ? 1 : 0);
  hotspots.forEach((h, i) => h.id = i + 1);

  return hotspots;
}

// ── Temporal clustering ──

function temporalCluster(events: GameEvent[]): GameEvent[][] {
  if (events.length === 0) return [];
  const clusters: GameEvent[][] = [];
  let cur: GameEvent[] = [];
  let lastMs = 0;

  for (const ev of events) {
    const ms = parseTs(ev.ts);
    if (isNaN(ms)) continue;
    if (cur.length > 0 && ms - lastMs > CLUSTER_GAP_SEC * 1000) {
      clusters.push(cur);
      cur = [];
    }
    cur.push(ev);
    lastMs = ms;
  }
  if (cur.length > 0) clusters.push(cur);
  return clusters;
}

function splitLongCluster(events: GameEvent[], maxSec: number): GameEvent[][] {
  if (events.length <= 1) return [events];
  const t0 = parseTs(events[0]!.ts);
  const tN = parseTs(events[events.length - 1]!.ts);
  if (tN - t0 <= maxSec * 1000) return [events];

  let bestGap = 0, bestIdx = Math.floor(events.length / 2);
  for (let i = 1; i < events.length; i++) {
    const g = parseTs(events[i]!.ts) - parseTs(events[i - 1]!.ts);
    if (g > bestGap) { bestGap = g; bestIdx = i; }
  }
  return [
    ...splitLongCluster(events.slice(0, bestIdx), maxSec),
    ...splitLongCluster(events.slice(bestIdx), maxSec),
  ];
}

// ── Killstreak extraction ──

function extractKillstreaks(events: GameEvent[]): HotspotEvent[] {
  if (events.length === 0) return [];
  const maxGapMs = MAX_STREAK_GAP_SEC * 1000;

  interface StreakInfo {
    current: number; best: number;
    curVictims: number[]; bestVictims: number[];
    curTimes: string[]; bestTimes: string[];
    lastKillMs: number;
  }
  const streaks = new Map<number, StreakInfo>();
  const getStreak = (id: number): StreakInfo => {
    let s = streaks.get(id);
    if (!s) { s = { current: 0, best: 0, curVictims: [], bestVictims: [], curTimes: [], bestTimes: [], lastKillMs: 0 }; streaks.set(id, s); }
    return s;
  };

  for (const ev of events) {
    if (ev.type !== 'kill') continue;
    const ms = parseTs(ev.ts);
    const s = getStreak(ev.src);
    if (s.current > 0 && s.lastKillMs > 0 && ms - s.lastKillMs > maxGapMs) {
      s.current = 0; s.curVictims = []; s.curTimes = [];
    }
    s.current++; s.lastKillMs = ms;
    if (ev.dst) s.curVictims.push(ev.dst);
    s.curTimes.push(ev.ts);
    if (s.current >= s.best) {
      s.best = s.current;
      s.bestVictims = [...s.curVictims];
      s.bestTimes = [...s.curTimes];
    }
    if (ev.dst) {
      const vs = getStreak(ev.dst);
      vs.current = 0; vs.curVictims = []; vs.curTimes = []; vs.lastKillMs = 0;
    }
  }

  const results: HotspotEvent[] = [];
  for (const [playerID, s] of streaks) {
    if (s.best < MIN_STREAK_KILLS) continue;
    const unitSet = new Set([playerID, ...s.bestVictims]);
    const unitIDs = [...unitSet].sort((a, b) => a - b);
    const startTs = addSecondsToTs(s.bestTimes[0]!, -3);
    const endTs = addSecondsToTs(s.bestTimes[s.bestTimes.length - 1]!, 12);
    const peakTs = s.bestTimes[s.bestTimes.length - 1]!;
    let score = s.best * 3.0 + s.best * 2.5 + unitSet.size * 0.3;
    if (s.best >= 5) score += s.best * 1.5;

    results.push({
      id: 0, type: 'killstreak',
      startTs, endTs, peakTs,
      centerLat: 0, centerLng: 0, radius: 100,
      score, label: `连杀 ×${s.best}`,
      kills: s.best, hits: 0,
      units: unitIDs, focusUnitId: playerID,
    });
  }

  results.sort((a, b) => b.score !== a.score ? b.score - a.score : (a.focusUnitId ?? 0) - (b.focusUnitId ?? 0));
  return results;
}

// ── Cluster analysis ──

function analyseCluster(events: GameEvent[]): HotspotEvent {
  let kills = 0, hits = 0;
  const allUnits = new Set<number>();
  const tsCounts = new Map<string, number>();
  const maxGapMs = MAX_STREAK_GAP_SEC * 1000;

  interface StreakInfo { current: number; best: number; curTimes: string[]; bestTimes: string[]; curVictims: number[]; bestVictims: number[]; totalKills: number; lastKillMs: number }
  const streaks = new Map<number, StreakInfo>();
  const getStreak = (id: number): StreakInfo => {
    let s = streaks.get(id);
    if (!s) { s = { current: 0, best: 0, curTimes: [], bestTimes: [], curVictims: [], bestVictims: [], totalKills: 0, lastKillMs: 0 }; streaks.set(id, s); }
    return s;
  };

  for (const ev of events) {
    if (ev.type === 'kill') {
      kills++;
      const ms = parseTs(ev.ts);
      const s = getStreak(ev.src);
      if (s.current > 0 && s.lastKillMs > 0 && ms - s.lastKillMs > maxGapMs) {
        s.current = 0; s.curVictims = []; s.curTimes = [];
      }
      s.current++; s.totalKills++; s.lastKillMs = ms;
      if (ev.dst) s.curVictims.push(ev.dst);
      s.curTimes.push(ev.ts);
      if (s.current >= s.best) {
        s.best = s.current;
        s.bestVictims = [...s.curVictims];
        s.bestTimes = [...s.curTimes];
      }
      if (ev.dst) {
        const vs = getStreak(ev.dst);
        vs.current = 0; vs.curVictims = []; vs.curTimes = []; vs.lastKillMs = 0;
      }
    } else { hits++; }
    allUnits.add(ev.src);
    if (ev.dst) allUnits.add(ev.dst);
    tsCounts.set(ev.ts, (tsCounts.get(ev.ts) ?? 0) + 1);
  }

  // Peak timestamp
  let peakTs = events[0]!.ts, peakCount = 0;
  for (const [ts, c] of tsCounts) { if (c > peakCount) { peakCount = c; peakTs = ts; } }

  // Top streak
  let maxStreak = 0, topShooterID = 0;
  let topShooterTimes: string[] = [];
  let topShooterVictims: number[] = [];
  for (const [id, s] of streaks) {
    if (s.best > maxStreak || (s.best === maxStreak && maxStreak > 0 && s.totalKills > (streaks.get(topShooterID)?.totalKills ?? 0))) {
      maxStreak = s.best; topShooterID = id;
      topShooterTimes = s.bestTimes;
      topShooterVictims = s.bestVictims;
    }
  }

  // Score
  let score = kills * 3.0 + hits * 0.5 + allUnits.size * 0.3;
  if (maxStreak >= MIN_STREAK_KILLS) score += maxStreak * 2.5;
  if (kills >= 5) score += kills * 1.5;

  // Classify
  const t0 = parseTs(events[0]!.ts);
  const tN = parseTs(events[events.length - 1]!.ts);
  const durMs = tN - t0;

  let evType = 'firefight', label = '';
  if (kills >= 5 && durMs < 45000) {
    evType = 'mass_casualty'; label = `大规模伤亡 ${kills}阵亡`;
  } else if (maxStreak >= MIN_STREAK_KILLS) {
    evType = 'killstreak'; label = `连杀 ×${maxStreak}`;
  } else if (allUnits.size >= 15 && kills >= MIN_KILLS_ENGAGE) {
    evType = 'engagement'; label = `大规模交火 ${allUnits.size}人 ${kills}阵亡`;
  } else {
    if (kills < MIN_KILLS_FIREFIGHT) score = 0;
    label = `交火 ${kills}击杀 ${hits}命中`;
  }

  // Units
  let unitIDs: number[];
  if (evType === 'killstreak' && topShooterID) {
    const s = new Set([topShooterID, ...topShooterVictims]);
    unitIDs = [...s].sort((a, b) => a - b);
  } else {
    unitIDs = [...allUnits].sort((a, b) => a - b);
  }

  let startTs = addSecondsToTs(events[0]!.ts, -3);
  let endTs = addSecondsToTs(events[events.length - 1]!.ts, 5);
  if (evType === 'killstreak' && topShooterTimes.length > 0) {
    startTs = addSecondsToTs(topShooterTimes[0]!, -3);
    endTs = addSecondsToTs(topShooterTimes[topShooterTimes.length - 1]!, 5);
    peakTs = topShooterTimes[topShooterTimes.length - 1]!;
  }

  return {
    id: 0, type: evType, startTs, endTs, peakTs,
    centerLat: 0, centerLng: 0, radius: 100,
    score, label, kills, hits,
    units: unitIDs,
    focusUnitId: evType === 'killstreak' ? topShooterID : undefined,
  };
}

// ── Long-range kill detection ──

function detectLongRangeKills(db: Database, resolver: CoordResolver, combatEvents: GameEvent[]): HotspotEvent[] {
  const kills = combatEvents.filter(e => e.type === 'kill' && e.src && e.dst);
  if (kills.length === 0) return [];

  const startTs = kills[0]!.ts;
  const endTs = kills[kills.length - 1]!.ts;

  // Load position frames in kill time range
  const stmt = db.prepare(`
    SELECT LogTime, LogData FROM record
    WHERE SrcType=1 AND DataType=1
      AND LogTime >= datetime(?, '-10 seconds')
      AND LogTime <= datetime(?, '+5 seconds')
    ORDER BY LogTime ASC
  `);
  stmt.bind([startTs, endTs]);

  interface PosFrame { ms: number; data: ReturnType<typeof decodePositionFrame> }
  const frames: PosFrame[] = [];
  while (stmt.step()) {
    const row = stmt.get();
    const tsStr = row[0] as string;
    const blob = row[1] as Uint8Array;
    if (!blob) continue;
    frames.push({ ms: parseTs(tsStr), data: decodePositionFrame(blob) });
  }
  stmt.free();

  // Merge pass
  const latestPos = new Map<number, { lat: number; lng: number; ms: number }>();
  let fi = 0;
  const maxAgeMs = MAX_POS_AGE_SEC * 1000;
  const candidates: HotspotEvent[] = [];

  for (const kill of kills) {
    const killMs = parseTs(kill.ts);
    // Advance frames
    while (fi < frames.length && frames[fi]!.ms <= killMs) {
      const f = frames[fi]!;
      for (const u of f.data) {
        if (u.rawLat === 0 && u.rawLng === 0) continue;
        const [lat, lng] = resolver.convert(u.rawLat, u.rawLng);
        if (lat !== 0 || lng !== 0) latestPos.set(u.id, { lat, lng, ms: f.ms });
      }
      fi++;
    }

    const src = latestPos.get(kill.src);
    const dst = latestPos.get(kill.dst);
    if (!src || !dst) continue;
    if (killMs - src.ms > maxAgeMs || killMs - dst.ms > maxAgeMs) continue;

    const dist = haversineDist(src.lat, src.lng, dst.lat, dst.lng);
    if (dist < LONG_RANGE_MIN_M) continue;

    const distInt = Math.round(dist);
    candidates.push({
      id: 0, type: 'long_range',
      startTs: addSecondsToTs(kill.ts, -3),
      endTs: addSecondsToTs(kill.ts, 5),
      peakTs: kill.ts,
      centerLat: (src.lat + dst.lat) / 2,
      centerLng: (src.lng + dst.lng) / 2,
      radius: Math.max(60, dist * 0.6),
      score: dist / 5.0,
      label: `超远击杀 ${distInt}m`,
      kills: 1, hits: 0,
      units: [kill.src, kill.dst],
      focusUnitId: kill.src,
      distance: distInt,
      srcLat: src.lat, srcLng: src.lng,
      dstLat: dst.lat, dstLng: dst.lng,
    });
  }

  // Descending sweep: find highest non-empty bucket
  candidates.sort((a, b) => (b.distance ?? 0) - (a.distance ?? 0));
  for (let floor = LONG_RANGE_MAX_M; floor >= LONG_RANGE_MIN_M; floor -= LONG_RANGE_STEP) {
    const bucket = candidates.filter(h => (h.distance ?? 0) >= floor);
    if (bucket.length > 0) return bucket.slice(0, LONG_RANGE_TOP_N);
  }
  return [];
}

// ── Spatial info lookup ──

function lookupSpatialInfo(
  db: Database, resolver: CoordResolver,
  startTs: string, endTs: string, unitIDs: number[],
): [number, number, number] {
  if (unitIDs.length === 0) return [0, 0, 100];
  const idSet = new Set(unitIDs);

  const stmt = db.prepare(`
    SELECT LogData FROM record
    WHERE SrcType=1 AND DataType=1
      AND LogTime >= datetime(?, '-5 seconds')
      AND LogTime <= datetime(?, '+5 seconds')
    ORDER BY LogTime ASC
  `);
  stmt.bind([startTs, endTs]);

  const seen = new Set<string>();
  const pts: [number, number][] = [];

  while (stmt.step()) {
    const blob = stmt.get()[0] as Uint8Array;
    if (!blob) continue;
    for (const u of decodePositionFrame(blob)) {
      if (!idSet.has(u.id) || (u.rawLat === 0 && u.rawLng === 0)) continue;
      const [lat, lng] = resolver.convert(u.rawLat, u.rawLng);
      if (lat === 0 && lng === 0) continue;
      const key = `${u.id}|${Math.round(lat * 10000)}|${Math.round(lng * 10000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pts.push([lat, lng]);
    }
  }
  stmt.free();

  if (pts.length === 0) return [0, 0, 100];

  // Density center
  const [cLat, cLng] = densityCenter(pts);
  if (cLat === 0 && cLng === 0) return [0, 0, 100];

  // P80 radius
  const dists = pts.map(([lat, lng]) => haversineDist(cLat, cLng, lat, lng)).sort((a, b) => a - b);
  const p80Idx = Math.floor((dists.length - 1) * 0.8);
  const radius = Math.max(40, Math.min(400, dists[p80Idx]! * 1.15));

  return [cLat, cLng, radius];
}

function densityCenter(pts: [number, number][]): [number, number] {
  if (pts.length === 0) return [0, 0];
  if (pts.length === 1) return pts[0]!;
  if (pts.length === 2) return [(pts[0]![0] + pts[1]![0]) / 2, (pts[0]![1] + pts[1]![1]) / 2];

  const DENSITY_R = 150, CLUSTER_R = 200;

  let bestIdx = 0, bestCount = -1;
  for (let i = 0; i < pts.length; i++) {
    let count = 0;
    for (let j = 0; j < pts.length; j++) {
      if (i !== j && haversineDist(pts[i]![0], pts[i]![1], pts[j]![0], pts[j]![1]) <= DENSITY_R) count++;
    }
    if (count > bestCount) { bestCount = count; bestIdx = i; }
  }

  const peak = pts[bestIdx]!;
  let sumLat = 0, sumLng = 0, cnt = 0;
  for (const p of pts) {
    if (haversineDist(peak[0], peak[1], p[0], p[1]) <= CLUSTER_R) {
      sumLat += p[0]; sumLng += p[1]; cnt++;
    }
  }
  return cnt > 0 ? [sumLat / cnt, sumLng / cnt] : peak;
}

// ── Deduplication ──

function deduplicateHotspots(hotspots: HotspotEvent[]): HotspotEvent[] {
  if (hotspots.length <= 1) return hotspots;
  hotspots.sort((a, b) => b.score - a.score);
  const keep = new Array(hotspots.length).fill(true);

  for (let i = 0; i < hotspots.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < hotspots.length; j++) {
      if (!keep[j]) continue;
      if (hotspotsOverlap(hotspots[i]!, hotspots[j]!)) keep[j] = false;
    }
  }

  return hotspots.filter((_, i) => keep[i]);
}

function hotspotsOverlap(a: HotspotEvent, b: HotspotEvent): boolean {
  const aStart = parseTs(a.startTs), aEnd = parseTs(a.endTs);
  const bStart = parseTs(b.startTs), bEnd = parseTs(b.endTs);
  const overlapStart = Math.max(aStart, bStart);
  const overlapEnd = Math.min(aEnd, bEnd);
  if (overlapEnd < overlapStart) return false;
  if (overlapEnd - overlapStart < DEDUP_OVERLAP_SEC * 1000) return false;
  if (a.centerLat === 0 || b.centerLat === 0) return false;
  return haversineDist(a.centerLat, a.centerLng, b.centerLat, b.centerLng) <= DEDUP_DIST_M;
}
