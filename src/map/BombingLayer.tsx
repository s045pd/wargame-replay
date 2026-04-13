import { useEffect, useRef, useCallback } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import { BombingEvent } from '../lib/api';
import { useVisualConfig } from '../store/visualConfig';

interface BombingLayerProps {
  map: mapboxgl.Map;
  bombingEvents: BombingEvent[];
  currentTs: string;
}

const SOURCE_ID = 'bombing-source';
const BLAST_LAYER_ID = 'bombing-blast-layer';
const CORE_LAYER_ID = 'bombing-core-layer';
const LABEL_LAYER_ID = 'bombing-label-layer';
const SHOCKWAVE_SOURCE = 'bombing-shockwave-source';
const SHOCKWAVE_LAYER = 'bombing-shockwave-layer';
const FLASH_LAYER = 'bombing-flash-layer';

// How long (in ms) a bombing marker stays visible after its timestamp
const DISPLAY_DURATION_MS = 120_000; // 2 minutes
// Fallback shockwave animation duration (real-time ms) — overridden by visualConfig
const DEFAULT_SHOCKWAVE_DURATION_MS = 2500;
/** Delay before second ring starts (must be < shockwave duration) */
const RING2_DELAY_MS = 200;
// Initial flash duration
const FLASH_DURATION_MS = 600;

function eventLabel(ev: BombingEvent): string {
  if (ev.subType === 1) return '空投';  // airdrop
  return '轰炸';  // bombing
}

/** Convert hex (#rrggbb) to rgba string */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function eventColor(ev: BombingEvent): string {
  if (ev.subType === 1) return 'rgba(50, 200, 255, 0.6)';  // airdrop = cyan
  const bc = useVisualConfig.getState().bombingColor || '#ff3c14';
  return hexToRgba(bc, 0.7);
}

function eventBlastColor(ev: BombingEvent): string {
  if (ev.subType === 1) return 'rgba(50, 200, 255, 0.15)';
  const bc = useVisualConfig.getState().bombingColor || '#ff3c14';
  return hexToRgba(bc, 0.18);
}

/**
 * Build GeoJSON for bombing events that should be visible at the current time.
 */
function buildGeoJson(
  events: BombingEvent[],
  currentTs: string,
): GeoJSON.FeatureCollection {
  const now = new Date(currentTs).getTime();
  if (isNaN(now)) {
    return { type: 'FeatureCollection', features: [] };
  }

  const features: GeoJSON.Feature[] = [];

  for (const ev of events) {
    const evTime = new Date(ev.ts).getTime();
    if (isNaN(evTime)) continue;

    const delta = now - evTime;
    if (delta < -30_000 || delta > DISPLAY_DURATION_MS) continue;

    const age = Math.max(0, delta);
    const fadeRatio = 1 - age / DISPLAY_DURATION_MS;
    const opacity = Math.max(0.2, fadeRatio);

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [ev.lng, ev.lat],
      },
      properties: {
        label: eventLabel(ev),
        time: ev.ts.slice(11, 19),
        color: eventColor(ev),
        blastColor: eventBlastColor(ev),
        opacity,
        param: ev.param,
        subType: ev.subType,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function BombingLayer({ map, bombingEvents, currentTs }: BombingLayerProps) {
  const eventsRef = useRef(bombingEvents);
  eventsRef.current = bombingEvents;
  const tsRef = useRef(currentTs);
  tsRef.current = currentTs;

  // Track shockwave animations per event
  const shockwaveStartRef = useRef(new Map<string, number>()); // evTs → wall-clock start
  const animRef = useRef<number>(0);
  const isAnimatingRef = useRef(false);

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildGeoJson(eventsRef.current, tsRef.current),
    });

    map.addSource(SHOCKWAVE_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // Outer blast radius
    map.addLayer({
      id: BLAST_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 30,
        'circle-color': ['get', 'blastColor'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-opacity': ['*', ['get', 'opacity'], 0.5],
        'circle-pitch-alignment': 'map',
      },
    });

    // Inner impact point
    map.addLayer({
      id: CORE_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 8,
        'circle-color': ['get', 'color'],
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': ['*', ['get', 'opacity'], 0.8],
        'circle-pitch-alignment': 'map',
      },
    });

    // Shockwave expanding ring
    map.addLayer({
      id: SHOCKWAVE_LAYER,
      type: 'circle',
      source: SHOCKWAVE_SOURCE,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': 'transparent',
        'circle-opacity': 0,
        'circle-stroke-width': ['get', 'strokeWidth'],
        'circle-stroke-color': ['get', 'strokeColor'],
        'circle-stroke-opacity': ['get', 'strokeOpacity'],
        'circle-pitch-alignment': 'map',
      },
    });

    // Impact flash (bright center pulse)
    map.addLayer({
      id: FLASH_LAYER,
      type: 'circle',
      source: SHOCKWAVE_SOURCE,
      filter: ['==', ['get', 'isFlash'], 1],
      paint: {
        'circle-radius': ['get', 'flashRadius'],
        'circle-color': '#ffee44',
        'circle-opacity': ['get', 'flashOpacity'],
        'circle-blur': 0.5,
        'circle-pitch-alignment': 'map',
      },
    });

    // Event label
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['concat', ['get', 'label'], ' ', ['get', 'time']],
        'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [0, -2.8],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
        'text-opacity': ['get', 'opacity'],
      },
    });
  }, [map]);

  useEffect(() => {
    addSourceAndLayers();
    const onStyleLoad = () => addSourceAndLayers();
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      cancelAnimationFrame(animRef.current);
      isAnimatingRef.current = false;
      try {
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(FLASH_LAYER)) map.removeLayer(FLASH_LAYER);
        if (map.getLayer(SHOCKWAVE_LAYER)) map.removeLayer(SHOCKWAVE_LAYER);
        if (map.getLayer(CORE_LAYER_ID)) map.removeLayer(CORE_LAYER_ID);
        if (map.getLayer(BLAST_LAYER_ID)) map.removeLayer(BLAST_LAYER_ID);
        if (map.getSource(SHOCKWAVE_SOURCE)) map.removeSource(SHOCKWAVE_SOURCE);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* ignore */ }
    };
   
  }, [map, addSourceAndLayers]);

  // Update static markers + trigger shockwave animations
  useEffect(() => {
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const geojson = buildGeoJson(bombingEvents, currentTs);
    source.setData(geojson);
    // geojson.features.length > 0 means active bombing events are visible

    // Detect newly appearing bombing events → start shockwave animation
    const curTime = new Date(currentTs).getTime();
    if (isNaN(curTime)) return;

    const now = performance.now();
    for (const ev of bombingEvents) {
      if (ev.subType === 1) continue; // no shockwave for airdrops
      const evTime = new Date(ev.ts).getTime();
      const delta = curTime - evTime;
      // Trigger shockwave when event is within 2 game-seconds of impact
      if (delta >= -1000 && delta <= 2000) {
        const key = `${ev.lat}_${ev.lng}_${ev.ts}`;
        if (!shockwaveStartRef.current.has(key)) {
          shockwaveStartRef.current.set(key, now);
        }
      }
    }

    // Purge old entries
    const shockwaveDurMs = (useVisualConfig.getState().bombingDuration * 1000) || DEFAULT_SHOCKWAVE_DURATION_MS;
    for (const [key, startTime] of shockwaveStartRef.current) {
      if (now - startTime > shockwaveDurMs + 500) {
        shockwaveStartRef.current.delete(key);
      }
    }

    // Start animation loop if needed
    if (shockwaveStartRef.current.size > 0 && !isAnimatingRef.current) {
      isAnimatingRef.current = true;

      const animateShockwave = () => {
        if (!isAnimatingRef.current) return;
        const animNow = performance.now();
        const vc = useVisualConfig.getState();
        const swDurMs = (vc.bombingDuration * 1000) || DEFAULT_SHOCKWAVE_DURATION_MS;
        const swColor = vc.bombingColor || '#ff3c14';
        const features: GeoJSON.Feature[] = [];
        let anyActive = false;

        for (const [key, startTime] of shockwaveStartRef.current) {
          const elapsed = animNow - startTime;
          // Must cover the delayed second ring (starts at RING2_DELAY_MS)
          if (elapsed > swDurMs + RING2_DELAY_MS) continue;
          anyActive = true;

          const [latStr, lngStr] = key.split('_');
          const lat = parseFloat(latStr);
          const lng = parseFloat(lngStr);

          // Expanding ring (first ring — only during shockwave duration)
          if (elapsed <= swDurMs) {
            const t = elapsed / swDurMs;
            const ringRadius = 10 + 60 * Math.pow(t, 0.5); // fast start, decelerates
            const ringOpacity = 0.8 * (1 - t);
            const strokeWidth = 3 * (1 - t * 0.7);

            features.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              properties: {
                radius: ringRadius,
                strokeWidth,
                strokeColor: swColor,
                strokeOpacity: ringOpacity,
              isFlash: 0,
              flashRadius: 0,
              flashOpacity: 0,
            },
          });
          }

          // Second shockwave ring (delayed)
          if (elapsed > RING2_DELAY_MS) {
            const t2 = (elapsed - RING2_DELAY_MS) / swDurMs;
            if (t2 < 1) {
              features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [lng, lat] },
                properties: {
                  radius: 10 + 45 * Math.pow(t2, 0.5),
                  strokeWidth: 2 * (1 - t2 * 0.7),
                  strokeColor: '#ffaa00',
                  strokeOpacity: 0.5 * (1 - t2),
                  isFlash: 0,
                  flashRadius: 0,
                  flashOpacity: 0,
                },
              });
            }
          }

          // Central flash
          if (elapsed < FLASH_DURATION_MS) {
            const ft = elapsed / FLASH_DURATION_MS;
            features.push({
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [lng, lat] },
              properties: {
                radius: 0,
                strokeWidth: 0,
                strokeColor: '#ffffff',
                strokeOpacity: 0,
                isFlash: 1,
                flashRadius: 20 * (1 - ft * 0.5),
                flashOpacity: 0.9 * (1 - ft),
              },
            });
          }
        }

        const swSrc = map.getSource(SHOCKWAVE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
        swSrc?.setData({ type: 'FeatureCollection', features });

        if (anyActive) {
          animRef.current = requestAnimationFrame(animateShockwave);
        } else {
          isAnimatingRef.current = false;
          swSrc?.setData({ type: 'FeatureCollection', features: [] });
        }
      };

      animRef.current = requestAnimationFrame(animateShockwave);
    }
  }, [map, bombingEvents, currentTs]);

  // ---------- reactive visibility for bombing blast radius ----------
  const bombingRadiusEnabled = useVisualConfig(s => s.bombingRadius);

  useEffect(() => {
    try {
      const vis = bombingRadiusEnabled ? 'visible' : 'none';
      if (map.getLayer(BLAST_LAYER_ID)) {
        map.setLayoutProperty(BLAST_LAYER_ID, 'visibility', vis);
      }
    } catch { /* ignore */ }
  }, [map, bombingRadiusEnabled]);

  return null;
}
