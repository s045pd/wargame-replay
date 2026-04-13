import { useEffect, useCallback, useRef } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import { Minefield } from '../lib/api';

interface MinefieldLayerProps {
  map: mapboxgl.Map;
  minefields: Minefield[];
}

const SOURCE_ID = 'minefield-source';
const FILL_LAYER_ID = 'minefield-fill';
const LINE_LAYER_ID = 'minefield-line';
const LABEL_LAYER_ID = 'minefield-label';

/** Orange/amber color scheme for danger zones */
const FILL_COLOR = '#ff8c00';
const LINE_COLOR = '#ff6600';

function buildGeoJson(minefields: Minefield[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: minefields.map((mf) => {
      // Corners are [lat, lng] — GeoJSON needs [lng, lat]
      const ring = mf.corners.map(([lat, lng]) => [lng, lat] as [number, number]);
      // Close the polygon
      if (ring.length > 0) ring.push(ring[0]);
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [ring],
        },
        properties: { id: mf.id },
      };
    }),
  };
}

function buildLabelGeoJson(minefields: Minefield[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: minefields.map((mf) => {
      // Centroid for label placement
      const lats = mf.corners.map(c => c[0]);
      const lngs = mf.corners.map(c => c[1]);
      const centerLat = lats.reduce((a, b) => a + b, 0) / lats.length;
      const centerLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [centerLng, centerLat],
        },
        properties: { id: mf.id, label: '雷区' },
      };
    }),
  };
}

export function MinefieldLayer({ map, minefields }: MinefieldLayerProps) {
  const dataRef = useRef(minefields);
  dataRef.current = minefields;

  const addLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildGeoJson(dataRef.current),
    });

    // Semi-transparent fill
    map.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': FILL_COLOR,
        'fill-opacity': 0.10,
      },
    });

    // Dashed border
    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': LINE_COLOR,
        'line-width': 1.5,
        'line-opacity': 0.6,
        'line-dasharray': [6, 4],
      },
    });

    // "雷区" labels at polygon centroids
    if (!map.getSource(SOURCE_ID + '-label')) {
      map.addSource(SOURCE_ID + '-label', {
        type: 'geojson',
        data: buildLabelGeoJson(dataRef.current),
      });
      map.addLayer({
        id: LABEL_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID + '-label',
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': LINE_COLOR,
          'text-halo-color': '#000000',
          'text-halo-width': 1,
          'text-opacity': 0.7,
        },
      });
    }
  }, [map]);

  useEffect(() => {
    addLayers();
    const onStyleLoad = () => addLayers();
    map.on('style.load', onStyleLoad);
    return () => {
      map.off('style.load', onStyleLoad);
      try {
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getSource(SOURCE_ID + '-label')) map.removeSource(SOURCE_ID + '-label');
        if (map.getLayer(LINE_LAYER_ID)) map.removeLayer(LINE_LAYER_ID);
        if (map.getLayer(FILL_LAYER_ID)) map.removeLayer(FILL_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch { /* map may be removed */ }
    };
  }, [map, addLayers]);

  // Update data
  useEffect(() => {
    const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(buildGeoJson(minefields));
    const labelSrc = map.getSource(SOURCE_ID + '-label') as mapboxgl.GeoJSONSource | undefined;
    if (labelSrc) labelSrc.setData(buildLabelGeoJson(minefields));
  }, [map, minefields]);

  return null;
}
