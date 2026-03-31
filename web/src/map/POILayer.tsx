import { useEffect, useRef, useCallback } from 'react';
import type mapboxgl from 'mapbox-gl';
import { POIObject } from '../lib/api';

interface POILayerProps {
  map: mapboxgl.Map;
  pois: POIObject[];
}

const SOURCE_ID = 'poi-source';
const CIRCLE_LAYER_ID = 'poi-circle-layer';
const LABEL_LAYER_ID = 'poi-label-layer';

/** Map team number to display color: 0=red, 1=blue, 2=neutral */
function teamColor(team: number): string {
  if (team === 0) return '#ff4444';
  if (team === 1) return '#00ccff';
  return '#ffaa00';
}

/** Chinese name for each POI type */
function poiTypeName(type: number): string {
  switch (type) {
    case 2: return '物资车';
    case 3: return '补给站';
    case 4: return '占领点';
    case 5: return '兵站';
    default: return '设施';
  }
}

/** Circle radius per POI type */
function poiRadius(type: number): number {
  switch (type) {
    case 2: return 5;   // vehicle — small
    case 3: return 7;   // supply cache
    case 4: return 8;   // control point — largest
    case 5: return 7;   // station
    default: return 6;
  }
}

/** Build a resource label string depending on POI type */
function resourceLabel(poi: POIObject): string {
  const name = poiTypeName(poi.type);
  switch (poi.type) {
    case 4:
      // Control point — show capture percentage
      return `${name} ${poi.resource}%`;
    case 3:
      // Supply cache — show remaining / max style
      return `${name} ${poi.resource}/10`;
    default:
      // Vehicle, station, etc. — show name + resource count
      return poi.resource > 0 ? `${name} ${poi.resource}` : name;
  }
}

function buildGeoJson(pois: POIObject[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pois
      // Filter out type=1 (base camps are rendered by BaseCampLayer)
      .filter(poi => poi.type !== 1)
      .map(poi => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [poi.lng, poi.lat],
        },
        properties: {
          id: poi.id,
          poiType: poi.type,
          team: poi.team,
          resource: poi.resource,
          color: teamColor(poi.team),
          radius: poiRadius(poi.type),
          label: resourceLabel(poi),
        },
      })),
  };
}

export function POILayer({ map, pois }: POILayerProps) {
  const poisRef = useRef(pois);
  poisRef.current = pois;

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildGeoJson(poisRef.current),
    });

    // Circle marker layer — sized and colored per POI type/team
    map.addLayer({
      id: CIRCLE_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': ['get', 'radius'],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.75,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.8,
        'circle-pitch-alignment': 'map',
      },
    });

    // Label layer — Chinese name + resource info
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 10,
        'text-offset': [0, -2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': ['get', 'color'],
        'text-halo-color': '#000000',
        'text-halo-width': 1.2,
      },
    });
  }, [map]);

  // Init + style change re-add + cleanup
  useEffect(() => {
    addSourceAndLayers();

    const onStyleLoad = () => addSourceAndLayers();
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      try {
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(CIRCLE_LAYER_ID)) map.removeLayer(CIRCLE_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // Map may already be removed
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, addSourceAndLayers]);

  // Update data when POIs change
  useEffect(() => {
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(buildGeoJson(pois));
    }
  }, [map, pois]);

  return null;
}
