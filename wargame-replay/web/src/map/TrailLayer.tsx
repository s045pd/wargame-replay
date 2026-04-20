import { useEffect, useRef } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import type { FilterSpecification } from 'maplibre-gl';
import { UnitPosition, GameEvent } from '../lib/api';
import type { FocusMode } from '../store/director';
import { usePlayback } from '../store/playback';
import { useVisualConfig } from '../store/visualConfig';

interface TrailLayerProps {
  map: mapboxgl.Map;
  units: UnitPosition[];
  trailEnabled: boolean;
  events?: GameEvent[];
  selectedUnitId?: number | null;
  focusMode?: FocusMode;
  /** Manual-follow focus unit — dims tracers not involving this unit (when director focus isn't active). */
  manualFocusUnitId?: number | null;
}

// ---------- source / layer IDs ----------
const ATTACK_SOURCE_ID = 'attack-lines-source';

const KILL_GLOW_LAYER = 'attack-kill-glow';
const KILL_CORE_LAYER = 'attack-kill-core';
const HIT_GLOW_LAYER = 'attack-hit-glow';
const HIT_CORE_LAYER = 'attack-hit-core';
const FOLLOW_GLOW_LAYER = 'attack-follow-glow';
const FOLLOW_CORE_LAYER = 'attack-follow-core';

const ALL_LAYERS = [
  FOLLOW_CORE_LAYER, FOLLOW_GLOW_LAYER,
  KILL_GLOW_LAYER, KILL_CORE_LAYER,
  HIT_GLOW_LAYER, HIT_CORE_LAYER,
] as const;

// ---------- colours (defaults – overridden at runtime from visualConfig) ----------
const KILL_COLOR = '#ff3333';
const HIT_COLOR = '#ffcc00';
const FOLLOW_COLOR = '#00ff66';
const FOLLOW_GLOW_COLOR = 'rgba(0, 255, 100, 0.55)';

// ---------- animation config (defaults — overridden by visualConfig) ----------

/** Convert hex color to rgba string */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface TracerEntry {
  srcLng: number;
  srcLat: number;
  dstLng: number;
  dstLat: number;
  isKill: boolean;
  isFollowed: boolean;
  startTime: number;
  /** Per-tracer animation duration (kill vs hit can differ) */
  durationMs: number;
  /** Opacity multiplier for focus mode: 1.0 = normal, <1 = dimmed */
  focusDim: number;
}

function lerpCoord(
  srcLng: number, srcLat: number,
  dstLng: number, dstLat: number,
  t: number,
): [number, number] {
  return [
    srcLng + (dstLng - srcLng) * t,
    srcLat + (dstLat - srcLat) * t,
  ];
}

function buildTracerCoords(
  entry: TracerEntry,
  now: number,
  durationMs: number,
  tracerLength: number,
): { coords: [number, number][]; opacity: number } | null {
  const elapsed = now - entry.startTime;
  if (elapsed < 0 || elapsed > durationMs) return null;

  const { srcLng, srcLat, dstLng, dstLat } = entry;
  const t = elapsed / durationMs;

  const headT = Math.min(t * (1 + tracerLength), 1 + tracerLength);
  const tailT = Math.max(0, headT - tracerLength);

  const clampedHead = Math.min(headT, 1);
  const clampedTail = Math.min(tailT, 1);

  if (clampedHead === clampedTail && clampedHead >= 1) return null;

  const head = lerpCoord(srcLng, srcLat, dstLng, dstLat, clampedHead);
  const tail = lerpCoord(srcLng, srcLat, dstLng, dstLat, clampedTail);

  return { coords: [tail, head], opacity: 1 };
}

function buildAnimatedGeoJson(
  tracers: TracerEntry[],
  now: number,
  tracerLength: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const tr of tracers) {
    const result = buildTracerCoords(tr, now, tr.durationMs, tracerLength);
    if (!result) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: result.coords,
      },
      properties: {
        isKill: tr.isKill,
        isFollowed: tr.isFollowed,
        opacity: result.opacity * tr.focusDim,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function TrailLayer({ map, units, trailEnabled, events, selectedUnitId, focusMode, manualFocusUnitId }: TrailLayerProps) {
  const layersAddedRef = useRef(false);
  const tracersRef = useRef<TracerEntry[]>([]);
  const rafRef = useRef<number>(0);
  const isAnimatingRef = useRef(false);
  const prevEventsRef = useRef<GameEvent[]>([]);

  // ---------- setup source + layers ----------
  useEffect(() => {
    function addLayers() {
      if (map.getSource(ATTACK_SOURCE_ID)) return;

      const vc = useVisualConfig.getState();
      const killColor = vc.killLineColor || KILL_COLOR;
      const killGlowColor = hexToRgba(killColor, 0.5);
      const hitColor = vc.hitLineColor || HIT_COLOR;
      const hitGlowColor = hexToRgba(hitColor, 0.4);
      const killW = vc.killLineWidth;
      const hitW = vc.hitLineWidth;

      map.addSource(ATTACK_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Filters: followed tracers get green, others get kill/hit colors
      const notFollowed = ['!=', ['get', 'isFollowed'], true] as unknown as FilterSpecification;
      const killFilter = ['all', ['==', ['get', 'isKill'], true], notFollowed] as unknown as FilterSpecification;
      const hitFilter = ['all', ['==', ['get', 'isKill'], false], notFollowed] as unknown as FilterSpecification;
      const followedFilter = ['==', ['get', 'isFollowed'], true] as unknown as FilterSpecification;

      // --- kill glow ---
      map.addLayer({
        id: KILL_GLOW_LAYER,
        type: 'line',
        source: ATTACK_SOURCE_ID,
        filter: killFilter,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': killGlowColor,
          'line-width': killW * 4.5,
          'line-opacity': ['get', 'opacity'],
          'line-blur': 8,
        },
      });

      // --- kill core ---
      map.addLayer({
        id: KILL_CORE_LAYER,
        type: 'line',
        source: ATTACK_SOURCE_ID,
        filter: killFilter,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': killColor,
          'line-width': killW,
          'line-opacity': ['get', 'opacity'],
        },
      });

      // --- hit glow ---
      map.addLayer({
        id: HIT_GLOW_LAYER,
        type: 'line',
        source: ATTACK_SOURCE_ID,
        filter: hitFilter,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': hitGlowColor,
          'line-width': hitW * 4,
          'line-opacity': ['get', 'opacity'],
          'line-blur': 5,
        },
      });

      // --- hit core ---
      map.addLayer({
        id: HIT_CORE_LAYER,
        type: 'line',
        source: ATTACK_SOURCE_ID,
        filter: hitFilter,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': hitColor,
          'line-width': hitW,
          'line-opacity': ['get', 'opacity'],
        },
      });

      // --- followed unit glow (green) ---
      map.addLayer({
        id: FOLLOW_GLOW_LAYER,
        type: 'line',
        source: ATTACK_SOURCE_ID,
        filter: followedFilter,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': FOLLOW_GLOW_COLOR,
          'line-width': 20,
          'line-opacity': ['get', 'opacity'],
          'line-blur': 8,
        },
      });

      // --- followed unit core (green) ---
      map.addLayer({
        id: FOLLOW_CORE_LAYER,
        type: 'line',
        source: ATTACK_SOURCE_ID,
        filter: followedFilter,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': FOLLOW_COLOR,
          'line-width': 5,
          'line-opacity': ['get', 'opacity'],
        },
      });

      layersAddedRef.current = true;
    }

    addLayers();

    const onStyleLoad = () => {
      layersAddedRef.current = false;
      addLayers();
    };

    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      cancelAnimationFrame(rafRef.current);
      isAnimatingRef.current = false;
      try {
        for (const id of ALL_LAYERS) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(ATTACK_SOURCE_ID)) map.removeSource(ATTACK_SOURCE_ID);
      } catch {
        // Map may already be removed
      }
      layersAddedRef.current = false;
    };
   
  }, [map]);

  // ---------- spawn new tracers when events arrive ----------
  useEffect(() => {
    if (!trailEnabled || !events || events === prevEventsRef.current) return;
    prevEventsRef.current = events;

    const unitMap = new Map<number, UnitPosition>();
    for (const u of units) {
      unitMap.set(u.id, u);
    }

    const now = performance.now();
    let addedCount = 0;

    // Pre-compute focus-related unit set for O(1) lookup
    const focusActive = focusMode?.active ?? false;
    const focusRelatedSet = new Set<number>(focusMode?.relatedUnitIds);
    const focusUnitId = focusMode?.focusUnitId ?? -1;
    // Manual follow dim — only applies when director focus is inactive
    const manualActive = !focusActive && manualFocusUnitId != null;
    const manualId = manualFocusUnitId ?? -1;

    const { killLineEnabled, hitLineEnabled } = usePlayback.getState();
    const vcDur = useVisualConfig.getState();
    const killDurMs = vcDur.killLineDuration * 1000;
    const hitDurMs = vcDur.hitLineDuration * 1000;

    for (const ev of events) {
      if (ev.type !== 'hit' && ev.type !== 'kill') continue;
      // Respect per-type toggles
      if (ev.type === 'kill' && !killLineEnabled) continue;
      if (ev.type === 'hit' && !hitLineEnabled) continue;
      const src = unitMap.get(ev.src);
      const dst = ev.dst !== undefined ? unitMap.get(ev.dst) : undefined;
      if (!src || !dst) continue;
      if (src.lng === undefined || src.lat === undefined) continue;
      if (dst.lng === undefined || dst.lat === undefined) continue;

      // Mark tracers from the followed unit as green
      const isFollowed = selectedUnitId != null && src.id === selectedUnitId;

      // Focus mode: dim tracers from non-related units
      let focusDim = 1.0;
      if (focusActive) {
        const srcIsRelated = src.id === focusUnitId || focusRelatedSet.has(src.id);
        const dstIsRelated = dst.id === focusUnitId || focusRelatedSet.has(dst.id);
        if (!srcIsRelated && !dstIsRelated) {
          focusDim = 0.06; // almost invisible
        }
      } else if (manualActive) {
        // Manual follow: soft dim for tracers that don't involve the followed unit
        if (src.id !== manualId && dst.id !== manualId) {
          focusDim = 0.3;
        }
      }

      tracersRef.current.push({
        srcLng: src.lng,
        srcLat: src.lat,
        dstLng: dst.lng,
        dstLat: dst.lat,
        isKill: ev.type === 'kill',
        isFollowed,
        startTime: now + addedCount * 60,
        durationMs: ev.type === 'kill' ? killDurMs : hitDurMs,
        focusDim,
      });
      addedCount++;
    }

    // Start animation loop if not already running
    if (!isAnimatingRef.current && tracersRef.current.length > 0) {
      isAnimatingRef.current = true;
      const animate = () => {
        if (!isAnimatingRef.current) return;

        const now = performance.now();
        // Read tracer visual length from visualConfig
        const vc = useVisualConfig.getState();
        const tracerLen = vc.tracerTrailLength / 400; // 80 → 0.2 (original default)

        // Prune expired tracers in-place (each tracer has its own duration)
        const tracers = tracersRef.current;
        let writeIdx = 0;
        for (let i = 0; i < tracers.length; i++) {
          if ((now - tracers[i].startTime) < tracers[i].durationMs) {
            tracers[writeIdx++] = tracers[i];
          }
        }
        tracers.length = writeIdx;

        const source = map.getSource(ATTACK_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (source) {
          if (tracersRef.current.length > 0) {
            source.setData(buildAnimatedGeoJson(tracersRef.current, now, tracerLen));
            rafRef.current = requestAnimationFrame(animate);
          } else {
            source.setData({ type: 'FeatureCollection', features: [] });
            isAnimatingRef.current = false;
          }
        } else {
          isAnimatingRef.current = false;
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    }
  }, [map, units, trailEnabled, events, selectedUnitId, focusMode, manualFocusUnitId]);

  // Clear when trails disabled
  useEffect(() => {
    if (!trailEnabled) {
      tracersRef.current = [];
      const source = map.getSource(ATTACK_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (source) {
        source.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }, [map, trailEnabled]);

  // ---------- reactive paint updates for kill/hit line colors, widths & style ----------
  const killLineColor = useVisualConfig(s => s.killLineColor);
  const hitLineColor = useVisualConfig(s => s.hitLineColor);
  const killLineWidth = useVisualConfig(s => s.killLineWidth);
  const hitLineWidth = useVisualConfig(s => s.hitLineWidth);
  const killLineStyle = useVisualConfig(s => s.killLineStyle);

  useEffect(() => {
    if (!layersAddedRef.current) return;
    try {
      const killGlowColor = hexToRgba(killLineColor || '#ff3333', 0.5);
      const hitGlowColor = hexToRgba(hitLineColor || '#ffcc00', 0.4);

      map.setPaintProperty(KILL_GLOW_LAYER, 'line-color', killGlowColor);
      map.setPaintProperty(KILL_CORE_LAYER, 'line-color', killLineColor || '#ff3333');
      map.setPaintProperty(KILL_GLOW_LAYER, 'line-width', (killLineWidth || 4) * 4.5);
      map.setPaintProperty(KILL_CORE_LAYER, 'line-width', killLineWidth || 4);

      map.setPaintProperty(HIT_GLOW_LAYER, 'line-color', hitGlowColor);
      map.setPaintProperty(HIT_CORE_LAYER, 'line-color', hitLineColor || '#ffcc00');
      map.setPaintProperty(HIT_GLOW_LAYER, 'line-width', (hitLineWidth || 2.5) * 4);
      map.setPaintProperty(HIT_CORE_LAYER, 'line-width', hitLineWidth || 2.5);

      // Kill line style: solid / dashed / pulse
      if (killLineStyle === 'dashed') {
        map.setLayoutProperty(KILL_CORE_LAYER, 'line-dasharray', [2, 2]);
        map.setPaintProperty(KILL_GLOW_LAYER, 'line-blur', 8);
      } else if (killLineStyle === 'pulse') {
        map.setLayoutProperty(KILL_CORE_LAYER, 'line-dasharray', undefined as unknown as number[]);
        map.setPaintProperty(KILL_GLOW_LAYER, 'line-blur', 14); // wider glow for pulse look
      } else {
        // solid (default)
        map.setLayoutProperty(KILL_CORE_LAYER, 'line-dasharray', undefined as unknown as number[]);
        map.setPaintProperty(KILL_GLOW_LAYER, 'line-blur', 8);
      }
    } catch { /* layers may not exist yet */ }
  }, [map, killLineColor, hitLineColor, killLineWidth, hitLineWidth, killLineStyle]);

  return null;
}
