// ── Coordinate detection ported from Go decoder/coords.go ──

import type { CoordMode, MapMeta } from './types';
import type { Database } from 'sql.js';
import { decodePositionFrame } from './decoder';

export interface CoordResolver {
  convert(rawLat: number, rawLng: number): [number, number];
  mode(): CoordMode;
}

class RelativeResolver implements CoordResolver {
  private minLat: number;
  private maxLat: number;
  private minLng: number;
  private maxLng: number;

  constructor(minLat: number, maxLat: number, minLng: number, maxLng: number) {
    this.minLat = minLat;
    this.maxLat = maxLat;
    this.minLng = minLng;
    this.maxLng = maxLng;
  }

  convert(rawLat: number, rawLng: number): [number, number] {
    const rangeLat = this.maxLat - this.minLat;
    const rangeLng = this.maxLng - this.minLng;
    const lat = rangeLat > 0 ? (rawLat - this.minLat) / rangeLat : 0;
    const lng = rangeLng > 0 ? (rawLng - this.minLng) / rangeLng : 0;
    return [Math.max(0, Math.min(1, lat)), Math.max(0, Math.min(1, lng))];
  }

  mode(): CoordMode { return 'relative'; }
}

class WGS84Resolver implements CoordResolver {
  private latScale: number;
  private latOffset: number;
  private lngScale: number;
  private lngOffset: number;

  constructor(latScale: number, latOffset: number, lngScale: number, lngOffset: number) {
    this.latScale = latScale;
    this.latOffset = latOffset;
    this.lngScale = lngScale;
    this.lngOffset = lngOffset;
  }

  convert(rawLat: number, rawLng: number): [number, number] {
    return [rawLat * this.latScale + this.latOffset, rawLng * this.lngScale + this.lngOffset];
  }

  mode(): CoordMode { return 'wgs84'; }
}

/** Scan all DT=1 records to find raw coordinate bounds. */
function scanCoordBounds(db: Database): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  const stmt = db.prepare(`SELECT LogData FROM record WHERE SrcType=1 AND DataType=1 AND LogData IS NOT NULL`);

  let minLat = 0xFFFFFFFF, maxLat = 0, minLng = 0xFFFFFFFF, maxLng = 0;
  let found = false;

  while (stmt.step()) {
    const blob = stmt.get()[0] as Uint8Array;
    if (!blob) continue;
    for (const u of decodePositionFrame(blob)) {
      if (u.rawLat === 0 && u.rawLng === 0) continue;
      found = true;
      if (u.rawLat < minLat) minLat = u.rawLat;
      if (u.rawLat > maxLat) maxLat = u.rawLat;
      if (u.rawLng < minLng) minLng = u.rawLng;
      if (u.rawLng > maxLng) maxLng = u.rawLng;
    }
  }
  stmt.free();

  return found ? { minLat, maxLat, minLng, maxLng } : null;
}

/**
 * Auto-detect coordinate system using 5 heuristics.
 * Returns [resolver, coordMode].
 */
export function autoDetectCoords(
  db: Database,
  txtContent?: string,
): [CoordResolver, CoordMode] {
  const bounds = scanCoordBounds(db);
  if (!bounds) {
    return [new RelativeResolver(0, 1, 0, 1), 'relative'];
  }

  // Heuristic 1: .txt sidecar metadata — raw = (WGS84 + 180) × 1e6
  if (txtContent) {
    try {
      const meta: MapMeta = JSON.parse(txtContent);
      if (meta.OK && meta.CenterOK) {
        return [new WGS84Resolver(1e-6, -180, 1e-6, -180), 'wgs84'];
      }
    } catch { /* invalid JSON, fall through */ }
  }

  // Heuristic 2: raw × 1e-6 - 180
  const testLat6 = bounds.minLat * 1e-6 - 180;
  const testLng6 = bounds.minLng * 1e-6 - 180;
  if (testLat6 > -90 && testLat6 < 90 && testLng6 > -180 && testLng6 < 180) {
    return [new WGS84Resolver(1e-6, -180, 1e-6, -180), 'wgs84'];
  }

  // Heuristic 3: raw / 1e7
  const testLat = bounds.minLat / 1e7;
  const testLng = bounds.minLng / 1e7;
  if (testLat > -90 && testLat < 90 && testLng > -180 && testLng < 180) {
    return [new WGS84Resolver(1e-7, 0, 1e-7, 0), 'wgs84'];
  }

  // Heuristic 4: lat/1e7, lng/1e7 + 80 (China)
  const testLng80 = bounds.minLng / 1e7 + 80;
  if (testLat > 18 && testLat < 55 && testLng80 > 73 && testLng80 < 136) {
    return [new WGS84Resolver(1e-7, 0, 1e-7, 80), 'wgs84'];
  }

  // Heuristic 5: lat/1e7, lng/1e7 + 90
  const testLng90 = bounds.minLng / 1e7 + 90;
  if (testLat > 18 && testLat < 55 && testLng90 > 73 && testLng90 < 136) {
    return [new WGS84Resolver(1e-7, 0, 1e-7, 90), 'wgs84'];
  }

  // Fallback: relative coordinates
  return [new RelativeResolver(bounds.minLat, bounds.maxLat, bounds.minLng, bounds.maxLng), 'relative'];
}

/** Parse .txt sidecar content into MapMeta. */
export function parseMapMeta(txtContent: string): MapMeta | null {
  try {
    const meta: MapMeta = JSON.parse(txtContent);
    if (meta.OK && meta.CenterOK) return meta;
    return null;
  } catch {
    return null;
  }
}
