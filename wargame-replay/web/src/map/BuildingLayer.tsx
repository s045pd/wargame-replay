import { useEffect, useRef } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import { getMapboxToken } from './styles';

interface BuildingLayerProps {
  map: mapboxgl.Map;
}

const BUILDING_SOURCE = 'mapbox-buildings-vector';
const BUILDING_LAYER = '3d-buildings';

/**
 * Adds a 3D fill-extrusion building layer using Mapbox vector tiles.
 * Only activates when a Mapbox token is available.
 * Buildings become visible when the map is tilted (pitch > 0).
 */
export function BuildingLayer({ map }: BuildingLayerProps) {
  const addedRef = useRef(false);

  useEffect(() => {
    const token = getMapboxToken();
    if (!token) return;

    function addBuildings() {
      if (map.getSource(BUILDING_SOURCE)) return;

      map.addSource(BUILDING_SOURCE, {
        type: 'vector',
        tiles: [
          `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf?access_token=${token}`,
        ],
        maxzoom: 15,
      });

      // Insert buildings BEFORE any unit/trail layers so they don't cover icons
      // Find the first custom layer (attack lines, unit layers, etc.) to insert before it
      const layers = map.getStyle()?.layers || [];
      let beforeId: string | undefined;
      for (const l of layers) {
        if (l.id.startsWith('attack-') || l.id.startsWith('unit-') || l.id.startsWith('sniper-')) {
          beforeId = l.id;
          break;
        }
      }

      map.addLayer(
        {
          id: BUILDING_LAYER,
          source: BUILDING_SOURCE,
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': [
              'interpolate', ['linear'], ['get', 'height'],
              0, '#1a1a2e',
              50, '#252545',
              200, '#303060',
            ],
            'fill-extrusion-height': [
              'interpolate', ['linear'], ['zoom'],
              14, 0,
              15.5, ['get', 'height'],
            ],
            'fill-extrusion-base': [
              'interpolate', ['linear'], ['zoom'],
              14, 0,
              15.5, ['get', 'min_height'],
            ],
            'fill-extrusion-opacity': 0.7,
          },
        } as mapboxgl.LayerSpecification,
        beforeId,
      );

      addedRef.current = true;
    }

    addBuildings();

    // Re-add after style changes (setStyle removes all layers)
    const onStyleLoad = () => {
      addedRef.current = false;
      addBuildings();
    };
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      try {
        if (map.getLayer(BUILDING_LAYER)) map.removeLayer(BUILDING_LAYER);
        if (map.getSource(BUILDING_SOURCE)) map.removeSource(BUILDING_SOURCE);
      } catch {
        // Map may already be removed
      }
      addedRef.current = false;
    };
  }, [map]);

  return null;
}
