import { useEffect, useRef, useCallback } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import { HotspotEvent } from '../lib/api';
import { useVisualConfig } from '../store/visualConfig';

interface HotspotLayerProps {
  map: mapboxgl.Map;
  hotspots: HotspotEvent[];
  currentTs: string;
}

const HS_SOURCE = 'hotspot-source';
const HS_PULSE_LAYER = 'hotspot-pulse';
const HS_CORE_LAYER = 'hotspot-core';
const HS_LABEL_LAYER = 'hotspot-label';

/** Colours per event type */
const TYPE_STYLES: Record<string, { core: string; pulse: string; text: string }> = {
  firefight:     { core: 'rgba(255, 160, 0, 0.50)', pulse: 'rgba(255, 160, 0, 0.20)', text: '#ff9900' },
  killstreak:    { core: 'rgba(255, 50, 30, 0.55)',  pulse: 'rgba(255, 50, 30, 0.25)', text: '#ff4422' },
  mass_casualty: { core: 'rgba(200, 0, 0, 0.55)',    pulse: 'rgba(200, 0, 0, 0.22)',   text: '#cc0000' },
  engagement:    { core: 'rgba(255, 120, 0, 0.48)',   pulse: 'rgba(255, 120, 0, 0.18)', text: '#ff8800' },
  bombardment:   { core: 'rgba(255, 255, 80, 0.50)',  pulse: 'rgba(255, 255, 80, 0.22)', text: '#ffee44' },
  long_range:    { core: 'rgba(0, 200, 255, 0.50)',   pulse: 'rgba(0, 200, 255, 0.20)',  text: '#00ccff' },
};
const DEFAULT_STYLE = TYPE_STYLES.firefight;

/** Parse "YYYY-MM-DD HH:MM:SS" to epoch ms */
function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

/**
 * Compute visual intensity (0→1) based on current time within the event.
 * Ramps up to peakTs, then fades to endTs.
 */
function eventIntensity(h: HotspotEvent, currentMs: number): number {
  const start = parseTs(h.startTs);
  const end = parseTs(h.endTs);
  const peak = parseTs(h.peakTs);
  if (currentMs <= start || currentMs >= end) return 0;

  if (currentMs <= peak) {
    // Ramp up
    const range = peak - start;
    return range > 0 ? 0.3 + 0.7 * ((currentMs - start) / range) : 1;
  }
  // Fade out
  const range = end - peak;
  return range > 0 ? 0.3 + 0.7 * (1 - (currentMs - peak) / range) : 0;
}

/** Convert meters to approximate pixels at current zoom (~lat 31°). */
function metersToPx(meters: number, zoom: number): number {
  return meters * Math.pow(2, zoom - 17) * 0.49;
}

function buildGeoJson(
  hotspots: HotspotEvent[],
  currentTs: string,
  zoom: number,
): GeoJSON.FeatureCollection {
  const currentMs = parseTs(currentTs);
  const features: GeoJSON.Feature[] = [];

  for (const h of hotspots) {
    const intensity = eventIntensity(h, currentMs);
    if (intensity < 0.05) continue;
    if (h.centerLat === 0 && h.centerLng === 0) continue;

    const style = TYPE_STYLES[h.type] || DEFAULT_STYLE;
    const basePx = metersToPx(h.radius, zoom);
    const corePx = Math.max(16, basePx * intensity);
    const pulsePx = Math.max(28, basePx * 1.6 * intensity);

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [h.centerLng, h.centerLat] },
      properties: {
        id: h.id,
        corePx,
        pulsePx,
        coreColor: style.core,
        pulseColor: style.pulse,
        textColor: style.text,
        label: h.label,
        intensity,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function HotspotLayer({ map, hotspots, currentTs }: HotspotLayerProps) {
  const hotspotRef = useRef(hotspots);
  hotspotRef.current = hotspots;
  const tsRef = useRef(currentTs);
  tsRef.current = currentTs;

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(HS_SOURCE)) return;

    const vc = useVisualConfig.getState();
    const hsColor = vc.hotspotCircleColor || '#ffa000';
    // Derive stroke rgba from hotspotCircleColor
    const r = parseInt(hsColor.slice(1, 3), 16);
    const g = parseInt(hsColor.slice(3, 5), 16);
    const b = parseInt(hsColor.slice(5, 7), 16);
    const pulseStroke = `rgba(${r}, ${g}, ${b}, 0.3)`;
    const coreStroke = `rgba(${r}, ${g}, ${b}, 0.5)`;

    const zoom = map.getZoom();
    map.addSource(HS_SOURCE, {
      type: 'geojson',
      data: buildGeoJson(hotspotRef.current, tsRef.current, zoom),
    });

    // Outer pulse ring
    map.addLayer({
      id: HS_PULSE_LAYER,
      type: 'circle',
      source: HS_SOURCE,
      paint: {
        'circle-radius': ['get', 'pulsePx'],
        'circle-color': ['get', 'pulseColor'],
        'circle-stroke-width': 1,
        'circle-stroke-color': pulseStroke,
        'circle-pitch-alignment': 'map',
      },
    });

    // Inner core circle
    map.addLayer({
      id: HS_CORE_LAYER,
      type: 'circle',
      source: HS_SOURCE,
      paint: {
        'circle-radius': ['get', 'corePx'],
        'circle-color': ['get', 'coreColor'],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': coreStroke,
        'circle-pitch-alignment': 'map',
      },
    });

    // Label
    map.addLayer({
      id: HS_LABEL_LAYER,
      type: 'symbol',
      source: HS_SOURCE,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [0, -2.5],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': ['get', 'textColor'],
        'text-halo-color': '#000000',
        'text-halo-width': 1.4,
        'text-opacity': ['get', 'intensity'],
      },
    });
  }, [map]);

  /** Throttle GeoJSON rebuilds to ~20fps — hotspot circles don't need 60fps updates */
  const lastUpdateRef = useRef(0);
  const HS_UPDATE_MIN_MS = 50; // ~20fps

  const updateSource = useCallback(() => {
    const now = performance.now();
    if (now - lastUpdateRef.current < HS_UPDATE_MIN_MS) return;
    lastUpdateRef.current = now;

    const source = map.getSource(HS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(buildGeoJson(hotspotRef.current, tsRef.current, map.getZoom()));
    }
  }, [map]);

  // Init + style change re-add
  useEffect(() => {
    addSourceAndLayers();

    const onStyleLoad = () => addSourceAndLayers();
    const onZoom = () => updateSource();

    map.on('style.load', onStyleLoad);
    map.on('zoomend', onZoom);

    return () => {
      map.off('style.load', onStyleLoad);
      map.off('zoomend', onZoom);
      try {
        if (map.getLayer(HS_LABEL_LAYER)) map.removeLayer(HS_LABEL_LAYER);
        if (map.getLayer(HS_CORE_LAYER)) map.removeLayer(HS_CORE_LAYER);
        if (map.getLayer(HS_PULSE_LAYER)) map.removeLayer(HS_PULSE_LAYER);
        if (map.getSource(HS_SOURCE)) map.removeSource(HS_SOURCE);
      } catch {
        // ignore
      }
    };
   
  }, [map, addSourceAndLayers, updateSource]);

  // Update every frame
  useEffect(() => {
    hotspotRef.current = hotspots;
    tsRef.current = currentTs;
    updateSource();
  }, [hotspots, currentTs, updateSource]);

  return null;
}
