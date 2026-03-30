import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import { UnitPosition } from '../lib/api';

interface UnitLayerProps {
  map: mapboxgl.Map;
  units: UnitPosition[];
  selectedUnitId?: number | null;
  onSelectUnit?: (id: number | null) => void;
}

const SOURCE_ID = 'units-source';
const LAYER_ID = 'units-layer';
const HOVER_LAYER_ID = 'units-hover-layer';
const SELECTED_LAYER_ID = 'units-selected-layer';
const LABEL_LAYER_ID = 'units-label-layer';

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

function buildGeoJson(units: UnitPosition[], selectedUnitId: number | null | undefined): GeoJSON.FeatureCollection {
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
          selected: u.id === selectedUnitId ? 1 : 0,
          label: `Unit ${u.id}`,
        },
      })),
  };
}

export function UnitLayer({ map, units, selectedUnitId, onSelectUnit }: UnitLayerProps) {
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const hoveredIdRef = useRef<number | null>(null);
  const onSelectUnitRef = useRef(onSelectUnit);
  onSelectUnitRef.current = onSelectUnit;

  useEffect(() => {
    const geojson = buildGeoJson(units, selectedUnitId);

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

    // Selection ring for selected unit
    map.addLayer({
      id: SELECTED_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['get', 'selected'], 1],
      paint: {
        'circle-radius': 14,
        'circle-color': 'transparent',
        'circle-opacity': 0,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.9,
      },
    });

    // Callsign label for selected unit
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'selected'], 1],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [0, -2],
        'text-anchor': 'bottom',
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
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

    // Click to select unit
    map.on('click', LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (!feature) return;
      const unitId = feature.properties?.id as number;
      onSelectUnitRef.current?.(unitId);
    });

    // Click on empty map area deselects
    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_ID] });
      if (features.length === 0) {
        onSelectUnitRef.current?.(null);
      }
    });

    return () => {
      if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
      if (map.getLayer(SELECTED_LAYER_ID)) map.removeLayer(SELECTED_LAYER_ID);
      if (map.getLayer(HOVER_LAYER_ID)) map.removeLayer(HOVER_LAYER_ID);
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      popup.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update data on every units change or selection change
  useEffect(() => {
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (source) {
      source.setData(buildGeoJson(units, selectedUnitId));
    }
  }, [map, units, selectedUnitId]);

  return null;
}
