import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

export interface HotspotData {
  score: number;
  center: [number, number]; // [lat, lng] from backend
  radius: number;
}

interface HotspotLayerProps {
  map: mapboxgl.Map;
  hotspot?: HotspotData | null;
}

const HS_SOURCE = 'hotspot-source';
const HS_PULSE_LAYER = 'hotspot-pulse';
const HS_CORE_LAYER = 'hotspot-core';
const HS_LABEL_LAYER = 'hotspot-label';

function scoreToColor(score: number): string {
  if (score > 0.6) return 'rgba(255, 50, 30, 0.45)';
  if (score > 0.3) return 'rgba(255, 140, 0, 0.40)';
  return 'rgba(255, 200, 50, 0.35)';
}

function scoreToPulseColor(score: number): string {
  if (score > 0.6) return 'rgba(255, 50, 30, 0.15)';
  if (score > 0.3) return 'rgba(255, 140, 0, 0.12)';
  return 'rgba(255, 200, 50, 0.10)';
}

/**
 * Convert meters to approximate pixels at current zoom for lat ~31.66°.
 * Formula: px = meters * 2^(zoom-17) * 0.49
 * (At zoom 17, ~0.49 px/m at this latitude.)
 */
function metersToPxAtZoom(meters: number, zoom: number): number {
  return meters * Math.pow(2, zoom - 17) * 0.49;
}

function buildHotspotGeoJson(
  hotspot: HotspotData | null | undefined,
  zoom: number,
): GeoJSON.FeatureCollection {
  if (!hotspot || hotspot.score < 0.05) {
    return { type: 'FeatureCollection', features: [] };
  }

  // Backend sends center as [lat, lng] — Mapbox needs [lng, lat]
  const lng = hotspot.center[1];
  const lat = hotspot.center[0];

  // Visual radius: 30m base + score-scaled up to 120m
  const meters = 30 + hotspot.score * 90;
  const corePx = metersToPxAtZoom(meters, zoom);
  const pulsePx = corePx * 1.8;

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          score: hotspot.score,
          corePx: Math.max(corePx, 8),
          pulsePx: Math.max(pulsePx, 14),
          coreColor: scoreToColor(hotspot.score),
          pulseColor: scoreToPulseColor(hotspot.score),
          label: `HOT ${Math.round(hotspot.score * 100)}%`,
        },
      },
    ],
  };
}

export function HotspotLayer({ map, hotspot }: HotspotLayerProps) {
  const hotspotRef = useRef(hotspot);
  hotspotRef.current = hotspot;

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(HS_SOURCE)) return;

    const zoom = map.getZoom();
    map.addSource(HS_SOURCE, {
      type: 'geojson',
      data: buildHotspotGeoJson(hotspotRef.current, zoom),
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
        'circle-stroke-color': 'rgba(255, 160, 0, 0.25)',
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
        'circle-stroke-color': 'rgba(255, 100, 0, 0.6)',
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
        'text-size': 10,
        'text-offset': [0, -2.2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ff8c00',
        'text-halo-color': '#000000',
        'text-halo-width': 1.2,
      },
    });
  }, [map]);

  // Update GeoJSON source with current zoom-scaled pixel values
  const updateSource = useCallback(() => {
    const source = map.getSource(HS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(buildHotspotGeoJson(hotspotRef.current, map.getZoom()));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, addSourceAndLayers, updateSource]);

  // Update hotspot data every frame
  useEffect(() => {
    hotspotRef.current = hotspot;
    updateSource();
  }, [hotspot, updateSource]);

  return null;
}
