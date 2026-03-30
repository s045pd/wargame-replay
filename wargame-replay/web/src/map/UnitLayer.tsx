import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { UnitPosition } from '../lib/api';

interface UnitLayerProps {
  map: mapboxgl.Map;
  units: UnitPosition[];
}

const SOURCE_ID = 'units-source';
const LAYER_ID = 'units-layer';
const HOVER_LAYER_ID = 'units-hover-layer';

function teamColor(team: string): string {
  if (team === 'red') return '#ff4444';
  if (team === 'blue') return '#00ccff';
  return '#aaaaaa';
}

function teamHaloColor(team: string): string {
  if (team === 'red') return '#ff8800';
  if (team === 'blue') return '#0066ff';
  return '#666666';
}

function buildGeoJson(units: UnitPosition[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: units
      .filter(u => u.alive && u.lng !== undefined && u.lat !== undefined)
      .map(u => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [u.lng!, u.lat!],
        },
        properties: {
          id: u.id,
          type: u.type,
          team: u.team,
          alive: u.alive,
          flags: u.flags,
          color: teamColor(u.team),
          haloColor: teamHaloColor(u.team),
        },
      })),
  };
}

export function UnitLayer({ map, units }: UnitLayerProps) {
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const hoveredIdRef = useRef<number | null>(null);

  useEffect(() => {
    const geojson = buildGeoJson(units);

    const existingSource = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (existingSource) {
      existingSource.setData(geojson);
      return;
    }

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: geojson,
    });

    // Glow/halo layer (larger, semi-transparent)
    map.addLayer({
      id: HOVER_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 12,
        'circle-color': ['get', 'haloColor'],
        'circle-opacity': 0.25,
        'circle-stroke-width': 0,
      },
    });

    // Main unit dot
    map.addLayer({
      id: LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.9,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.5,
      },
    });

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'unit-popup',
    });
    popupRef.current = popup;

    map.on('mouseenter', LAYER_ID, (e) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features?.[0];
      if (!feature) return;

      hoveredIdRef.current = feature.properties?.id as number;

      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const team = feature.properties?.team as string;
      const unitId = feature.properties?.id as number;
      const flags = feature.properties?.flags as string;

      popup
        .setLngLat(coords)
        .setHTML(
          `<div style="font-family: monospace; font-size: 12px; background: #111; color: #eee; padding: 6px 10px; border-radius: 4px; border: 1px solid #333;">
            <div><strong>Unit ${unitId}</strong></div>
            <div>Team: <span style="color: ${teamColor(team)}">${team}</span></div>
            ${flags ? `<div>Flags: ${flags}</div>` : ''}
          </div>`
        )
        .addTo(map);
    });

    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
      hoveredIdRef.current = null;
      popup.remove();
    });

    return () => {
      if (map.getLayer(HOVER_LAYER_ID)) map.removeLayer(HOVER_LAYER_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      popup.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update data on every units change
  useEffect(() => {
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(buildGeoJson(units));
    }
  }, [map, units]);

  return null;
}
