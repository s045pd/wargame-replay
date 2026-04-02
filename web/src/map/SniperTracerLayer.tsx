import { useEffect, useRef, useCallback } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import type { HotspotEvent } from '../lib/api';
import { useVisualConfig } from '../store/visualConfig';

interface SniperTracerLayerProps {
  map: mapboxgl.Map;
  /** All hotspots — we filter for active long_range with coords */
  hotspots: HotspotEvent[];
  currentTs: string;
}

const LINE_SOURCE = 'sniper-tracer-line-source';
const HEAD_SOURCE = 'sniper-tracer-head-source';
const LINE_LAYER = 'sniper-tracer-line-layer';
const GLOW_LAYER = 'sniper-tracer-glow-layer';
const HEAD_LAYER = 'sniper-tracer-head-layer';

// ── Fallback durations (overridden by visualConfig at runtime) ──
const DEFAULT_TRACER_DURATION_MS = 300;
const DEFAULT_LINGER_MS = 800;

/**
 * SniperTracerLayer — renders an animated tracer ray for long-range kills.
 *
 * When a long_range hotspot is active (currentTs within [startTs, endTs]):
 *   - A bright cyan line grows from shooter → victim position
 *   - A glowing bullet-head moves along the line
 *   - The animation plays during the first few seconds of the hotspot window
 *
 * The camera chase is handled by the auto-director (follow mode on focusUnitId),
 * not by this layer.
 */
export function SniperTracerLayer({ map, hotspots, currentTs }: SniperTracerLayerProps) {
  const animRef = useRef<number>(0);
  const activeHsRef = useRef<HotspotEvent | null>(null);
  const startWallRef = useRef<number>(0);

  const addSourcesAndLayers = useCallback(() => {
    if (map.getSource(LINE_SOURCE)) return;

    const vc = useVisualConfig.getState();
    const tracerColor = vc.sniperTracerColor || '#00ccff';
    const tracerW = vc.tracerWidth;

    // Line source (for the tracer path)
    map.addSource(LINE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Head source (for the bullet head point)
    map.addSource(HEAD_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Outer glow line
    map.addLayer({
      id: GLOW_LAYER,
      type: 'line',
      source: LINE_SOURCE,
      paint: {
        'line-color': tracerColor,
        'line-width': tracerW * 3,
        'line-opacity': ['get', 'glowOpacity'],
        'line-blur': 8,
      },
      layout: { 'line-cap': 'round' },
    });

    // Core tracer line
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: LINE_SOURCE,
      paint: {
        'line-color': '#ffffff',
        'line-width': tracerW,
        'line-opacity': ['get', 'lineOpacity'],
      },
      layout: { 'line-cap': 'round' },
    });

    // Bullet head
    map.addLayer({
      id: HEAD_LAYER,
      type: 'circle',
      source: HEAD_SOURCE,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': '#ffffff',
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-width': 2,
        'circle-stroke-color': tracerColor,
        'circle-stroke-opacity': ['get', 'opacity'],
      },
    });
  }, [map]);

  useEffect(() => {
    addSourcesAndLayers();
    const onStyleLoad = () => addSourcesAndLayers();
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      cancelAnimationFrame(animRef.current);
      try {
        if (map.getLayer(HEAD_LAYER)) map.removeLayer(HEAD_LAYER);
        if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
        if (map.getLayer(GLOW_LAYER)) map.removeLayer(GLOW_LAYER);
        if (map.getSource(HEAD_SOURCE)) map.removeSource(HEAD_SOURCE);
        if (map.getSource(LINE_SOURCE)) map.removeSource(LINE_SOURCE);
      } catch { /* ignore */ }
    };
   
  }, [map, addSourcesAndLayers]);

  // ── Main animation effect ──
  useEffect(() => {
    if (!currentTs) return;

    // Early exit if sniper tracers are disabled
    const vcCheck = useVisualConfig.getState();
    if (!vcCheck.sniperTracerEnabled) {
      const lineSrc = map.getSource(LINE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      const headSrc = map.getSource(HEAD_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      lineSrc?.setData({ type: 'FeatureCollection', features: [] });
      headSrc?.setData({ type: 'FeatureCollection', features: [] });
      cancelAnimationFrame(animRef.current);
      return;
    }

    const curMs = new Date(currentTs.replace(' ', 'T')).getTime();
    if (isNaN(curMs)) return;

    // Find the best active long_range hotspot with coordinates
    let best: HotspotEvent | null = null;
    for (const hs of hotspots) {
      if (hs.type !== 'long_range') continue;
      if (!hs.srcLat || !hs.srcLng || !hs.dstLat || !hs.dstLng) continue;
      const start = new Date(hs.startTs.replace(' ', 'T')).getTime();
      const end = new Date(hs.endTs.replace(' ', 'T')).getTime();
      if (curMs >= start && curMs <= end) {
        if (!best || hs.score > best.score) best = hs;
      }
    }

    // If no active long_range or different hotspot, clear previous
    if (!best || best.id !== activeHsRef.current?.id) {
      activeHsRef.current = best;
      startWallRef.current = best ? performance.now() : 0;
    }

    if (!best) {
      // Clear visuals
      const lineSrc = map.getSource(LINE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      const headSrc = map.getSource(HEAD_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      lineSrc?.setData({ type: 'FeatureCollection', features: [] });
      headSrc?.setData({ type: 'FeatureCollection', features: [] });
      cancelAnimationFrame(animRef.current);
      return;
    }

    const srcCoord: [number, number] = [best.srcLng!, best.srcLat!];
    const dstCoord: [number, number] = [best.dstLng!, best.dstLat!];

    const animate = () => {
      const vc = useVisualConfig.getState();
      const tracerDurMs = (vc.tracerDuration * 1000) || DEFAULT_TRACER_DURATION_MS;
      // Linger is roughly 2.5x tracer duration (preserves the original ratio ~800/300)
      const lingerMs = tracerDurMs * 2.67 || DEFAULT_LINGER_MS;
      const elapsed = performance.now() - startWallRef.current;
      const totalMs = tracerDurMs + lingerMs;

      if (elapsed > totalMs) {
        // Animation done — clear
        const lineSrc = map.getSource(LINE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
        const headSrc = map.getSource(HEAD_SOURCE) as mapboxgl.GeoJSONSource | undefined;
        lineSrc?.setData({ type: 'FeatureCollection', features: [] });
        headSrc?.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      // t: 0→1 during tracer travel, then stays at 1 during linger
      const t = Math.min(elapsed / tracerDurMs, 1);
      // Fast ease-out — bullet arrives almost instantly
      const eased = 1 - Math.pow(1 - t, 3);

      // Current bullet position
      const curLng = srcCoord[0] + (dstCoord[0] - srcCoord[0]) * eased;
      const curLat = srcCoord[1] + (dstCoord[1] - srcCoord[1]) * eased;

      // Build line from src to current bullet position
      // During linger phase, show full line but fade
      const lingerT = elapsed > tracerDurMs
        ? (elapsed - tracerDurMs) / lingerMs
        : 0;
      const lineOpacity = 1 - lingerT * 0.9; // fade quickly
      const glowOpacity = (1 - lingerT) * 0.6;

      // Straight line from source to current bullet position
      const segments: [number, number][] = [srcCoord, [curLng, curLat]];

      const lineSrc = map.getSource(LINE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      lineSrc?.setData({
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: segments,
          },
          properties: {
            lineOpacity,
            glowOpacity,
          },
        }],
      });

      // Bullet head — visible only during travel, fades quickly after arrival
      const headVisible = t < 1;
      const headOpacity = headVisible ? 1 : Math.max(0, 1 - lingerT * 3);
      const headRadius = headVisible ? 5 : 5 * Math.max(0, 1 - lingerT * 3);

      // Impact flash at destination when bullet arrives
      const impactFlash = t >= 0.8 && lingerT < 0.4;
      const impactRadius = impactFlash ? 15 * (1 - lingerT / 0.4) : 0;
      const impactOpacity = impactFlash ? 0.8 * Math.max(0, 1 - lingerT / 0.4) : 0;

      const headFeatures: GeoJSON.Feature[] = [];
      if (headOpacity > 0) {
        headFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [curLng, curLat] },
          properties: { opacity: headOpacity, radius: headRadius },
        });
      }
      if (impactRadius > 0 && impactOpacity > 0) {
        headFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: dstCoord },
          properties: { opacity: impactOpacity, radius: impactRadius },
        });
      }

      const headSrc = map.getSource(HEAD_SOURCE) as mapboxgl.GeoJSONSource | undefined;
      headSrc?.setData({ type: 'FeatureCollection', features: headFeatures });

      animRef.current = requestAnimationFrame(animate);
    };

    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animRef.current);
  }, [map, hotspots, currentTs]);

  return null;
}
