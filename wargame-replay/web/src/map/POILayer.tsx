import { useEffect, useRef, useCallback } from 'react';
import type * as mapboxgl from 'maplibre-gl';
import { POIObject } from '../lib/api';
import { poiTypeToIconKey, poiTeamToColorKey, poiIconName, registerPOIIcons } from './poiIcons';

interface POILayerProps {
  map: mapboxgl.Map;
  pois: POIObject[];
}

const SOURCE_ID = 'poi-source';
const ICON_LAYER_ID = 'poi-icon-layer';
const LABEL_LAYER_ID = 'poi-label-layer';

const RANGE_SOURCE_ID = 'poi-range-source';
const RANGE_FILL_ID = 'poi-range-fill';
const RANGE_LINE_ID = 'poi-range-line';

/** Map team number to display color hex */
function teamColor(team: number): string {
  if (team === 0) return '#ff4444';
  if (team === 1) return '#00ccff';
  return '#ffaa00';
}

/** Effective radius (metres) per POI type */
function poiRadius(type: number): number {
  switch (type) {
    case 2: return 25;  // 兵站
    case 3: return 20;  // 补给站
    case 4: return 25;  // 争夺点
    case 5: return 30;  // 前哨
    default: return 20;
  }
}

/** Label for each POI type */
function poiTypeName(type: number): string {
  switch (type) {
    case 2: return '兵站';
    case 3: return '补给站';
    case 4: return '争夺点';
    case 5: return '前哨';
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

/** Generate a GeoJSON circle polygon from center + radius in metres */
const EARTH_RADIUS = 6371000;
function geoCircle(lng: number, lat: number, radiusM: number, pts = 48): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusM / EARTH_RADIUS) * (180 / Math.PI);
  const dLng = dLat / Math.cos(latRad);
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
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

/** Build range-circle polygons for all POIs */
function buildRangeGeoJson(pois: POIObject[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const poi of pois) {
    if (poi.type === 1 || poi.lat === 0 || poi.lng === 0) continue;
    const circle = geoCircle(poi.lng, poi.lat, poiRadius(poi.type));
    circle.properties = { color: teamColor(poi.team) };
    features.push(circle);
  }
  return { type: 'FeatureCollection', features };
}

export function POILayer({ map, pois }: POILayerProps) {
  const poisRef = useRef(pois);
  poisRef.current = pois;

  const addSourceAndLayers = useCallback(() => {
    // --- Range circles (rendered below icons) ---
    if (!map.getSource(RANGE_SOURCE_ID)) {
      map.addSource(RANGE_SOURCE_ID, {
        type: 'geojson',
        data: buildRangeGeoJson(poisRef.current),
      });

      map.addLayer({
        id: RANGE_FILL_ID,
        type: 'fill',
        source: RANGE_SOURCE_ID,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.08,
        },
      });

      map.addLayer({
        id: RANGE_LINE_ID,
        type: 'line',
        source: RANGE_SOURCE_ID,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.2,
          'line-opacity': 0.45,
          'line-dasharray': [4, 3],
        },
      });
    }

    // --- Icon + label ---
    if (!map.getSource(SOURCE_ID)) {
      registerPOIIcons(map);

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: buildGeoJson(poisRef.current),
      });

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
    }
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
        if (map.getLayer(RANGE_LINE_ID)) map.removeLayer(RANGE_LINE_ID);
        if (map.getLayer(RANGE_FILL_ID)) map.removeLayer(RANGE_FILL_ID);
        if (map.getSource(RANGE_SOURCE_ID)) map.removeSource(RANGE_SOURCE_ID);
      } catch {
        // Map may already be removed
      }
    };
   
  }, [map, addSourceAndLayers]);

  // Update data when POIs change
  useEffect(() => {
    const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(buildGeoJson(pois));
    const rng = map.getSource(RANGE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (rng) rng.setData(buildRangeGeoJson(pois));
  }, [map, pois]);

  return null;
}
