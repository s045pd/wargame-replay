import { useEffect, useCallback, useRef, useState } from 'react';
import type * as mapboxgl from 'mapbox-gl';
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

/** Pre-compute all grid lines from graticule parameters. */
function computeGridData(
  grat: Graticule,
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number },
) {
  const rows: { lat: number; label: string }[] = [];
  const cols: { lng: number; label: string }[] = [];

  if (!bounds) return { rows, cols, minLat: 0, maxLat: 0, minLng: 0, maxLng: 0, lines: emptyFC() };

  const minLat = bounds.minLat - grat.latSpace;
  const maxLat = bounds.maxLat + grat.latSpace;
  const minLng = bounds.minLng - grat.lngSpace;
  const maxLng = bounds.maxLng + grat.lngSpace;

  const lineFeatures: GeoJSON.Feature[] = [];

  // Latitude lines (horizontal) — Y axis, labeled 1, 2, 3, ...
  let latIdx = 0;
  for (let lat = grat.latBegin; lat <= maxLat; lat += grat.latSpace) {
    if (lat < minLat) { latIdx++; continue; }
    rows.push({ lat, label: `${latIdx + 1}` });
    lineFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[minLng, lat], [maxLng, lat]] },
      properties: { axis: 'lat' },
    });
    latIdx++;
  }

  // Longitude lines (vertical) — X axis, labeled A, B, C, ...
  let lngIdx = 0;
  for (let lng = grat.lngBegin; lng <= maxLng; lng += grat.lngSpace) {
    if (lng < minLng) { lngIdx++; continue; }
    cols.push({ lng, label: letterLabel(lngIdx) });
    lineFeatures.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[lng, minLat], [lng, maxLat]] },
      properties: { axis: 'lng' },
    });
    lngIdx++;
  }

  return {
    rows, cols, minLat, maxLat, minLng, maxLng,
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

  // Update viewport-edge labels by projecting grid lines to screen pixels.
  // Use viewport center lng/lat so the projected point is always on-screen,
  // giving correct X/Y pixel coordinates for each grid line.
  const updateEdgeLabels = useCallback(() => {
    const { rows, cols } = gridRef.current;
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const center = map.getCenter();

    // Row labels (1, 2, 3...) pinned to LEFT edge:
    // project [center.lng, lat] to get screen-Y for each horizontal line
    const newLeft: EdgeLabel[] = [];
    for (const r of rows) {
      const pt = map.project([center.lng, r.lat]);
      if (pt.y >= 0 && pt.y <= h) {
        newLeft.push({ key: `r-${r.label}`, label: r.label, px: pt.y });
      }
    }

    // Column labels (A, B, C...) pinned to TOP edge:
    // project [lng, center.lat] to get screen-X for each vertical line
    const newTop: EdgeLabel[] = [];
    for (const c of cols) {
      const pt = map.project([c.lng, center.lat]);
      if (pt.x >= 0 && pt.x <= w) {
        newTop.push({ key: `c-${c.label}`, label: c.label, px: pt.x });
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, addLines, updateEdgeLabels]);

  return (
    <>
      {/* Column labels — pinned to top edge */}
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
      {/* Row labels — pinned to left edge */}
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
