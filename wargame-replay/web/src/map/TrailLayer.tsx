import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { UnitPosition } from '../lib/api';

interface TrailLayerProps {
  map: mapboxgl.Map;
  units: UnitPosition[];
  trailEnabled: boolean;
}

const TRAIL_SOURCE_ID = 'trails-source';
const TRAIL_LAYER_ID = 'trails-layer';
const MAX_TRAIL_LENGTH = 30;

type TrailBuffer = Map<number, Array<[number, number]>>;

function teamTrailColor(team: string): string {
  if (team === 'red') return '#ff4444';
  if (team === 'blue') return '#00ccff';
  return '#aaaaaa';
}

function buildTrailGeoJson(trailBuffer: TrailBuffer, units: UnitPosition[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const unit of units) {
    if (!unit.alive || unit.lng === undefined || unit.lat === undefined) continue;
    const trail = trailBuffer.get(unit.id);
    if (!trail || trail.length < 2) continue;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: trail,
      },
      properties: {
        id: unit.id,
        team: unit.team,
        color: teamTrailColor(unit.team),
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function TrailLayer({ map, units, trailEnabled }: TrailLayerProps) {
  const trailBufferRef = useRef<TrailBuffer>(new Map());
  const layersAddedRef = useRef(false);

  // Setup layers
  useEffect(() => {
    function addLayers() {
      if (map.getSource(TRAIL_SOURCE_ID)) return;

      map.addSource(TRAIL_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addLayer({
        id: TRAIL_LAYER_ID,
        type: 'line',
        source: TRAIL_SOURCE_ID,
        layout: {
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          // Fade from nearly transparent at start to fully opaque at end
          'line-opacity': 0.7,
        },
      });

      layersAddedRef.current = true;
    }

    addLayers();

    // Re-add layers after style change
    const onStyleLoad = () => {
      layersAddedRef.current = false;
      addLayers();
    };

    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      if (map.getLayer(TRAIL_LAYER_ID)) map.removeLayer(TRAIL_LAYER_ID);
      if (map.getSource(TRAIL_SOURCE_ID)) map.removeSource(TRAIL_SOURCE_ID);
      layersAddedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update trail buffer and render
  useEffect(() => {
    const buffer = trailBufferRef.current;

    for (const unit of units) {
      if (!unit.alive || unit.lng === undefined || unit.lat === undefined) continue;
      const existing = buffer.get(unit.id) ?? [];
      existing.push([unit.lng, unit.lat]);
      if (existing.length > MAX_TRAIL_LENGTH) {
        existing.splice(0, existing.length - MAX_TRAIL_LENGTH);
      }
      buffer.set(unit.id, existing);
    }

    const source = map.getSource(TRAIL_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;

    if (!trailEnabled) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    source.setData(buildTrailGeoJson(buffer, units));
  }, [map, units, trailEnabled]);

  return null;
}
