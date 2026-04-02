import { useEffect, useCallback, useRef, useState } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import { Graticule, GameMeta } from '../lib/api';

interface GraticuleLayerProps {
  map: mapboxgl.Map;
  graticule: Graticule;
  bounds?: GameMeta['bounds'];
}

const LINE_SOURCE_ID = 'graticule-line-source';
const LINE_LAYER_ID = 'graticule-line-layer';

/** Convert index to letter label: 0→A, 1→B, ... 25→Z, 26→AA */
function letterLabel(idx: number): string {
  let s = '';
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

interface GridRow { lat: number; label: string }
interface GridCol { lng: number; label: string }

/** Pre-compute all grid lines + zone labels from graticule parameters.
 *
 * Grid convention (per user requirement):
 *  - Vertical lines (longitude) divide columns; column label (A, B, C …)
 *    goes in the ZONE between two adjacent vertical lines.
 *  - Horizontal lines (latitude) divide rows; row label (1, 2, 3 …)
 *    goes in the ZONE between two adjacent horizontal lines.
 *  - A zone is therefore identified by e.g. "B3".
 *
 * `latBegin` is the NORTH edge of the grid. Lines go DOWNWARD (south).
 * `lngBegin` is the WEST edge of the grid. Lines go RIGHTWARD (east).
 */
function computeGridData(
  grat: Graticule,
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number },
) {
  const rows: GridRow[] = [];
  const cols: GridCol[] = [];
  // Zone centres: midpoints between consecutive grid lines for label placement
  const rowZones: { midLat: number; label: string }[] = [];
  const colZones: { midLng: number; label: string }[] = [];

  if (!bounds) return { rows, cols, rowZones, colZones, minLat: 0, maxLat: 0, minLng: 0, maxLng: 0, lines: emptyFC() };

  const pad = 1; // extra cells of padding around bounds
  const minLat = bounds.minLat - grat.latSpace * pad;
  const maxLat = bounds.maxLat + grat.latSpace * pad;
  const minLng = bounds.minLng - grat.lngSpace * pad;
  const maxLng = bounds.maxLng + grat.lngSpace * pad;

  const lineFeatures: GeoJSON.Feature[] = [];

  // ── Grid dimensions from `cr` field ──
  // `cr` encodes grid info in two bytes: high byte and low byte.
  // Columns = high + 2, Rows = low + 1.
  // e.g. cr=4110 (0x100E) → high=16,low=14 → 18 columns × 15 rows
  const totalCols = (grat.cr >> 8) + 2;
  const totalRows = (grat.cr & 0xFF) + 1;

  // ── Latitude lines (horizontal) — latBegin is NORTH edge, iterate SOUTHWARD ──
  // Generate lines from latBegin going south, plus one step north for padding
  for (let lat = grat.latBegin + grat.latSpace; lat >= minLat; lat -= grat.latSpace) {
    if (lat < minLat || lat > maxLat) continue;
    rows.push({ lat, label: '' });
    lineFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[minLng, lat], [maxLng, lat]] },
      properties: { axis: 'lat' },
    });
  }

  // Row zone labels — absolute index n (0 = northernmost zone from latBegin)
  // Label: bottom-to-top → 1 at southernmost (n = totalRows-1), ascending northward
  for (let n = -1; n <= totalRows; n++) {
    const northLat = grat.latBegin - n * grat.latSpace;
    const midLat = northLat - grat.latSpace / 2;
    if (midLat < minLat || midLat > maxLat) continue;
    if (n < 0 || n >= totalRows) continue; // only label zones within the grid
    rowZones.push({ midLat, label: `${totalRows - n}` });
  }

  // ── Longitude lines (vertical) — lngBegin is WEST edge, iterate EASTWARD ──
  for (let lng = grat.lngBegin - grat.lngSpace; lng <= maxLng; lng += grat.lngSpace) {
    if (lng < minLng || lng > maxLng) continue;
    cols.push({ lng, label: '' });
    lineFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[lng, minLat], [lng, maxLat]] },
      properties: { axis: 'lng' },
    });
  }

  // Column zone labels — absolute index n (0 = westernmost zone from lngBegin)
  // Label: right-to-left → A at easternmost, ascending westward
  // n=0 → R (letterLabel(totalCols-1)), n=totalCols-1 → A (letterLabel(0))
  for (let n = -1; n <= totalCols; n++) {
    const westLng = grat.lngBegin + n * grat.lngSpace;
    const midLng = westLng + grat.lngSpace / 2;
    if (midLng < minLng || midLng > maxLng) continue;
    if (n < 0 || n >= totalCols) continue;
    colZones.push({ midLng, label: letterLabel(totalCols - 1 - n) });
  }

  return {
    rows, cols, rowZones, colZones,
    minLat, maxLat, minLng, maxLng,
    lines: { type: 'FeatureCollection' as const, features: lineFeatures },
  };
}

function emptyFC(): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

interface EdgeLabel {
  key: string;
  label: string;
  px: number; // pixel position along the axis
}

export function GraticuleLayer({ map, graticule, bounds }: GraticuleLayerProps) {
  const gridRef = useRef(computeGridData(graticule, bounds));
  const [topLabels, setTopLabels] = useState<EdgeLabel[]>([]);
  const [leftLabels, setLeftLabels] = useState<EdgeLabel[]>([]);

  // Recompute grid data when props change
  useEffect(() => {
    gridRef.current = computeGridData(graticule, bounds);
  }, [graticule, bounds]);

  // Add line source+layer to map
  const addLines = useCallback(() => {
    if (map.getSource(LINE_SOURCE_ID)) return;
    const { lines } = gridRef.current;
    map.addSource(LINE_SOURCE_ID, { type: 'geojson', data: lines });
    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: LINE_SOURCE_ID,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.15)',
        'line-width': 0.8,
        'line-dasharray': [4, 4],
      },
    });
  }, [map]);

  // Update viewport-edge labels by projecting zone midpoints to screen pixels.
  // Labels are placed at the ZONE CENTRE (between two grid lines), not on lines.
  const updateEdgeLabels = useCallback(() => {
    const { rowZones, colZones } = gridRef.current;
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const center = map.getCenter();

    // Row zone labels (1, 2, 3 …) pinned to LEFT edge:
    // project [center.lng, midLat] to get screen-Y for each zone centre
    const newLeft: EdgeLabel[] = [];
    for (const r of rowZones) {
      const pt = map.project([center.lng, r.midLat]);
      if (pt.y >= 0 && pt.y <= h) {
        newLeft.push({ key: `rz-${r.label}`, label: r.label, px: pt.y });
      }
    }

    // Column zone labels (A, B, C …) pinned to TOP edge:
    // project [midLng, center.lat] to get screen-X for each zone centre
    const newTop: EdgeLabel[] = [];
    for (const c of colZones) {
      const pt = map.project([c.midLng, center.lat]);
      if (pt.x >= 0 && pt.x <= w) {
        newTop.push({ key: `cz-${c.label}`, label: c.label, px: pt.x });
      }
    }

    setLeftLabels(newLeft);
    setTopLabels(newTop);
  }, [map]);

  // Mount lines + listen for map move to update edge labels
  useEffect(() => {
    addLines();
    updateEdgeLabels();

    const onMove = () => updateEdgeLabels();
    map.on('move', onMove);

    const onStyleLoad = () => {
      addLines();
      updateEdgeLabels();
    };
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('move', onMove);
      map.off('style.load', onStyleLoad);
      try {
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
        if (map.getSource(LINE_SOURCE_ID)) map.removeSource(LINE_SOURCE_ID);
      } catch {
        // ignore
      }
    };
   
  }, [map, addLines, updateEdgeLabels]);

  return (
    <>
      {/* Column zone labels (A, B, C …) — pinned to top edge, centred in zone */}
      {topLabels.map((l) => (
        <div
          key={l.key}
          className="absolute z-10 pointer-events-none select-none"
          style={{
            top: 4,
            left: l.px,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="text-[10px] font-mono text-white/30 bg-black/30 rounded px-1">
            {l.label}
          </span>
        </div>
      ))}
      {/* Row zone labels (1, 2, 3 …) — pinned to left edge, centred in zone */}
      {leftLabels.map((l) => (
        <div
          key={l.key}
          className="absolute z-10 pointer-events-none select-none"
          style={{
            left: 4,
            top: l.px,
            transform: 'translateY(-50%)',
          }}
        >
          <span className="text-[10px] font-mono text-white/30 bg-black/30 rounded px-1">
            {l.label}
          </span>
        </div>
      ))}
    </>
  );
}
