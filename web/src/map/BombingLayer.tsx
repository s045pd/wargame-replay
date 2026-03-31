import { useEffect, useRef, useCallback, useState } from 'react';
import type mapboxgl from 'mapbox-gl';
import { BombingEvent } from '../lib/api';

interface BombingLayerProps {
  map: mapboxgl.Map;
  bombingEvents: BombingEvent[];
  currentTs: string;
}

const SOURCE_ID = 'bombing-source';
const BLAST_LAYER_ID = 'bombing-blast-layer';
const CORE_LAYER_ID = 'bombing-core-layer';
const LABEL_LAYER_ID = 'bombing-label-layer';

// How long (in ms) a bombing marker stays visible after its timestamp
const DISPLAY_DURATION_MS = 120_000; // 2 minutes

function eventLabel(ev: BombingEvent): string {
  if (ev.subType === 1) return '空投';  // airdrop
  return '轰炸';  // bombing
}

function eventColor(ev: BombingEvent): string {
  if (ev.subType === 1) return 'rgba(50, 200, 255, 0.6)';  // airdrop = cyan
  return 'rgba(255, 60, 20, 0.7)';  // bombing = red-orange
}

function eventBlastColor(ev: BombingEvent): string {
  if (ev.subType === 1) return 'rgba(50, 200, 255, 0.15)';
  return 'rgba(255, 60, 20, 0.18)';
}

/**
 * Build GeoJSON for bombing events that should be visible at the current time.
 * An event is visible if currentTs >= event.ts and within DISPLAY_DURATION_MS.
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
    // Show events: from 30s before impact to DISPLAY_DURATION_MS after
    if (delta < -30_000 || delta > DISPLAY_DURATION_MS) continue;

    // Fade out over the display duration
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
        time: ev.ts.slice(11, 19), // HH:MM:SS
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

  // Track if any events are near current time for efficiency
  const [hasActiveEvents, setHasActiveEvents] = useState(false);

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildGeoJson(eventsRef.current, tsRef.current),
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
      try {
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(CORE_LAYER_ID)) map.removeLayer(CORE_LAYER_ID);
        if (map.getLayer(BLAST_LAYER_ID)) map.removeLayer(BLAST_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // ignore
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, addSourceAndLayers]);

  // Update on currentTs or bombingEvents change
  useEffect(() => {
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    const geojson = buildGeoJson(bombingEvents, currentTs);
    source.setData(geojson);
    setHasActiveEvents(geojson.features.length > 0);
  }, [map, bombingEvents, currentTs, hasActiveEvents]);

  return null;
}
