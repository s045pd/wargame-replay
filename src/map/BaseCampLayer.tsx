import { useEffect, useRef, useCallback } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import { BaseCamp } from '../lib/api';

interface BaseCampLayerProps {
  map: mapboxgl.Map;
  baseCamps: BaseCamp[];
}

const SOURCE_ID = 'basecamp-source';
const ICON_LAYER_ID = 'basecamp-icon-layer';
const LABEL_LAYER_ID = 'basecamp-label-layer';
const RING_LAYER_ID = 'basecamp-ring-layer';

function teamColor(team: string): string {
  if (team === 'red') return '#ff4444';
  if (team === 'blue') return '#00ccff';
  return '#aaaaaa';
}

function teamLabel(team: string): string {
  if (team === 'red') return '红方基地 Base';
  if (team === 'blue') return '蓝方基地 Base';
  return '基地 Base';
}

function buildGeoJson(baseCamps: BaseCamp[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: baseCamps.map(camp => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [camp.lng, camp.lat],
      },
      properties: {
        team: camp.team,
        color: teamColor(camp.team),
        label: teamLabel(camp.team),
      },
    })),
  };
}

export function BaseCampLayer({ map, baseCamps }: BaseCampLayerProps) {
  const campsRef = useRef(baseCamps);
  campsRef.current = baseCamps;

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildGeoJson(campsRef.current),
    });

    // Outer pulsing ring — large, faint halo
    map.addLayer({
      id: RING_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 22,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.15,
        'circle-stroke-width': 2,
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-opacity': 0.3,
        'circle-pitch-alignment': 'map',
      },
    });

    // Inner solid marker
    map.addLayer({
      id: ICON_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 8,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.8,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.9,
        'circle-pitch-alignment': 'map',
      },
    });

    // Label
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-offset': [0, -2.5],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#000000',
        'text-halo-width': 1.5,
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
        if (map.getLayer(ICON_LAYER_ID)) map.removeLayer(ICON_LAYER_ID);
        if (map.getLayer(RING_LAYER_ID)) map.removeLayer(RING_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // ignore
      }
    };
   
  }, [map, addSourceAndLayers]);

  // Update data if baseCamps change
  useEffect(() => {
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(buildGeoJson(baseCamps));
    }
  }, [map, baseCamps]);

  return null;
}
