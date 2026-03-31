import { useEffect, useRef, useCallback } from 'react';
import type * as mapboxgl from 'mapbox-gl';
import { POIObject } from '../lib/api';
import { poiTypeToIconKey, poiTeamToColorKey, poiIconName, registerPOIIcons } from './poiIcons';

interface POILayerProps {
  map: mapboxgl.Map;
  pois: POIObject[];
}

const SOURCE_ID = 'poi-source';
const ICON_LAYER_ID = 'poi-icon-layer';
const LABEL_LAYER_ID = 'poi-label-layer';

/** Map team number to display color hex */
function teamColor(team: number): string {
  if (team === 0) return '#ff4444';
  if (team === 1) return '#00ccff';
  return '#ffaa00';
}

/** Label for each POI type */
function poiTypeName(type: number): string {
  switch (type) {
    case 2: return '物资车';
    case 3: return '补给站';
    case 4: return '防御点 Defense';
    case 5: return '前哨 FOB';
    default: return '设施';
  }
}

/** Build a resource label string depending on POI type */
function resourceLabel(poi: POIObject): string {
  const name = poiTypeName(poi.type);
  switch (poi.type) {
    case 4:
      return `${name} ${poi.resource}%`;
    case 3:
      return `${name} ${poi.resource}/10`;
    default:
      return poi.resource > 0 ? `${name} ${poi.resource}` : name;
  }
}

function buildGeoJson(pois: POIObject[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: pois
      // Filter out type=1 (base camps are rendered by BaseCampLayer)
      .filter(poi => poi.type !== 1)
      .map(poi => {
        const iconKey = poiTypeToIconKey(poi.type);
        const colorKey = poiTeamToColorKey(poi.team);
        return {
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
            icon: poiIconName(iconKey, colorKey),
            label: resourceLabel(poi),
          },
        };
      }),
  };
}

export function POILayer({ map, pois }: POILayerProps) {
  const poisRef = useRef(pois);
  poisRef.current = pois;

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    // Register all POI icon images (idempotent)
    registerPOIIcons(map);

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildGeoJson(poisRef.current),
    });

    // Symbol layer with POI icons
    map.addLayer({
      id: ICON_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-anchor': 'center',
        'icon-pitch-alignment': 'map',
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
        'text-offset': [0, -1.5],
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
        if (map.getLayer(ICON_LAYER_ID)) map.removeLayer(ICON_LAYER_ID);
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
