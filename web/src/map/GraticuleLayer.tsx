import { useEffect, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { Graticule, GameMeta } from '../lib/api';

interface GraticuleLayerProps {
  map: mapboxgl.Map;
  graticule: Graticule;
  bounds?: GameMeta['bounds'];
}

const LINE_SOURCE_ID = 'graticule-line-source';
const LINE_LAYER_ID = 'graticule-line-layer';
const LABEL_SOURCE_ID = 'graticule-label-source';
const LABEL_LAYER_ID = 'graticule-label-layer';

/**
 * Build grid lines from graticule parameters.
 * Generates lat and lng lines within the given bounds (padded).
 */
function buildGridGeoJson(
  grat: Graticule,
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): { lines: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection } {
  const lineFeatures: GeoJSON.Feature[] = [];
  const labelFeatures: GeoJSON.Feature[] = [];

  if (!bounds) {
    return {
      lines: { type: 'FeatureCollection', features: [] },
      labels: { type: 'FeatureCollection', features: [] },
    };
  }

  // Pad bounds by 1 grid step
  const minLat = bounds.minLat - grat.latSpace;
  const maxLat = bounds.maxLat + grat.latSpace;
  const minLng = bounds.minLng - grat.lngSpace;
  const maxLng = bounds.maxLng + grat.lngSpace;

  // Latitude lines (horizontal)
  let latIdx = 0;
  for (let lat = grat.latBegin; lat <= maxLat; lat += grat.latSpace) {
    if (lat < minLat) { latIdx++; continue; }
    lineFeatures.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [minLng, lat],
          [maxLng, lat],
        ],
      },
      properties: { axis: 'lat', idx: latIdx },
    });
    // Label on left edge
    labelFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [minLng, lat] },
      properties: { label: `${latIdx}`, axis: 'lat' },
    });
    latIdx++;
  }

  // Longitude lines (vertical)
  let lngIdx = 0;
  for (let lng = grat.lngBegin; lng <= maxLng; lng += grat.lngSpace) {
    if (lng < minLng) { lngIdx++; continue; }
    lineFeatures.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lng, minLat],
          [lng, maxLat],
        ],
      },
      properties: { axis: 'lng', idx: lngIdx },
    });
    // Label on bottom edge
    labelFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, minLat] },
      properties: { label: `${lngIdx}`, axis: 'lng' },
    });
    lngIdx++;
  }

  return {
    lines: { type: 'FeatureCollection', features: lineFeatures },
    labels: { type: 'FeatureCollection', features: labelFeatures },
  };
}

export function GraticuleLayer({ map, graticule, bounds }: GraticuleLayerProps) {
  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(LINE_SOURCE_ID)) return;

    const { lines, labels } = buildGridGeoJson(graticule, bounds ?? undefined);

    map.addSource(LINE_SOURCE_ID, {
      type: 'geojson',
      data: lines,
    });

    map.addSource(LABEL_SOURCE_ID, {
      type: 'geojson',
      data: labels,
    });

    // Grid lines — subtle dashed
    map.addLayer(
      {
        id: LINE_LAYER_ID,
        type: 'line',
        source: LINE_SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': 'rgba(255, 255, 255, 0.15)',
          'line-width': 0.8,
          'line-dasharray': [4, 4],
        },
      },
    );

    // Grid labels
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: LABEL_SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': 9,
        'text-anchor': 'center',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': 'rgba(255, 255, 255, 0.35)',
        'text-halo-color': 'rgba(0, 0, 0, 0.5)',
        'text-halo-width': 1,
      },
    });
  }, [map, graticule, bounds]);

  useEffect(() => {
    addSourceAndLayers();

    const onStyleLoad = () => addSourceAndLayers();
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      try {
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
        if (map.getSource(LABEL_SOURCE_ID)) map.removeSource(LABEL_SOURCE_ID);
        if (map.getSource(LINE_SOURCE_ID)) map.removeSource(LINE_SOURCE_ID);
      } catch {
        // ignore
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, addSourceAndLayers]);

  return null;
}
