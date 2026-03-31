import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { UnitPosition, UnitClass, UNIT_CLASS_LABELS } from '../lib/api';
import { registerUnitIcons, iconName } from './unitIcons';

interface UnitLayerProps {
  map: mapboxgl.Map;
  units: UnitPosition[];
  selectedUnitId?: number | null;
  onSelectUnit?: (id: number | null) => void;
}

const SOURCE_ID = 'units-source';
const GLOW_LAYER_ID = 'units-glow-layer';
const ALIVE_LAYER_ID = 'units-alive-layer';
const DEAD_LAYER_ID = 'units-dead-layer';
const SELECTED_LAYER_ID = 'units-selected-layer';
const LABEL_LAYER_ID = 'units-label-layer';

/** Duration (ms) for smoothly interpolating between server frames */
const LERP_DURATION_MS = 900;

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

/** Stored previous + target positions per unit for interpolation */
interface UnitLerpState {
  prevLng: number;
  prevLat: number;
  targetLng: number;
  targetLat: number;
}

function buildGeoJson(
  units: UnitPosition[],
  selectedUnitId: number | null | undefined,
  lerpPositions?: Map<number, { lng: number; lat: number }>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: units
      .filter(u => u.lng !== undefined && u.lat !== undefined)
      .map(u => {
        const cls = (u.class || 'rifle') as UnitClass;
        // Use interpolated position if available
        const lerped = lerpPositions?.get(u.id);
        const lng = lerped?.lng ?? u.lng!;
        const lat = lerped?.lat ?? u.lat!;
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
          properties: {
            id: u.id,
            team: u.team,
            alive: u.alive ? 1 : 0,
            hp: u.hp,
            name: u.name || `#${u.id}`,
            unitClass: cls,
            classLabel: UNIT_CLASS_LABELS[cls],
            color: teamColor(u.team),
            haloColor: teamHaloColor(u.team),
            selected: u.id === selectedUnitId ? 1 : 0,
            // Icon name for symbol layer — alive with HP level or dead variant
            iconAlive: iconName(u.team, cls, false, u.hp),
            iconDead: iconName(u.team, cls, true, 0),
          },
        };
      }),
  };
}

export function UnitLayer({ map, units, selectedUnitId, onSelectUnit }: UnitLayerProps) {
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const onSelectUnitRef = useRef(onSelectUnit);
  onSelectUnitRef.current = onSelectUnit;
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const selectedRef = useRef(selectedUnitId);
  selectedRef.current = selectedUnitId;

  // --- Smooth interpolation state ---
  const lerpStatesRef = useRef<Map<number, UnitLerpState>>(new Map());
  const lerpStartRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const isAnimatingRef = useRef(false);

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    // Register shape icons (circle, square, cross, triangle, diamond)
    registerUnitIcons(map);

    const geojson = buildGeoJson(unitsRef.current, selectedRef.current);

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: geojson,
    });

    // Glow/halo ring behind alive units
    map.addLayer({
      id: GLOW_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['get', 'alive'], 1],
      paint: {
        'circle-radius': 12,
        'circle-color': ['get', 'haloColor'],
        'circle-opacity': 0.25,
        'circle-stroke-width': 0,
      },
    });

    // Alive units — symbol layer with shape icons
    map.addLayer({
      id: ALIVE_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'alive'], 1],
      layout: {
        'icon-image': ['get', 'iconAlive'],
        'icon-size': 1,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': 0.95,
      },
    });

    // Dead units — symbol layer with dimmed team-colored icons
    map.addLayer({
      id: DEAD_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'alive'], 0],
      layout: {
        'icon-image': ['get', 'iconDead'],
        'icon-size': 0.7,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': 0.5,
      },
    });

    // Selection ring — circle layer around selected unit
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
        'text-field': ['concat', ['get', 'name'], ' (', ['get', 'classLabel'], ')'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [0, -2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });
  }, [map]);

  useEffect(() => {
    addSourceAndLayers();

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'unit-popup',
    });
    popupRef.current = popup;

    const showPopup = (e: mapboxgl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features?.[0];
      if (!feature) return;

      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const team = feature.properties?.team as string;
      const name = feature.properties?.name as string;
      const hp = feature.properties?.hp as number;
      const alive = feature.properties?.alive as number;
      const classLabel = feature.properties?.classLabel as string;

      popup
        .setLngLat(coords)
        .setHTML(
          `<div style="font-family: monospace; font-size: 12px; background: #111; color: #eee; padding: 6px 10px; border-radius: 4px; border: 1px solid #333;">
            <div><strong>${name}</strong></div>
            <div>Team: <span style="color: ${teamColor(team)}">${team}</span></div>
            <div>Class: ${classLabel}</div>
            ${alive === 0 ? '<div style="color: #ff4444;">KIA</div>' : `<div>HP: ${hp}/100</div>`}
          </div>`
        )
        .addTo(map);
    };

    map.on('mouseenter', ALIVE_LAYER_ID, showPopup);
    map.on('mouseenter', DEAD_LAYER_ID, showPopup);

    map.on('mouseleave', ALIVE_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });

    map.on('mouseleave', DEAD_LAYER_ID, () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });

    map.on('click', ALIVE_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (feature) onSelectUnitRef.current?.(feature.properties?.id as number);
    });

    map.on('click', DEAD_LAYER_ID, (e) => {
      const feature = e.features?.[0];
      if (feature) onSelectUnitRef.current?.(feature.properties?.id as number);
    });

    map.on('click', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [ALIVE_LAYER_ID, DEAD_LAYER_ID] });
      if (features.length === 0) {
        onSelectUnitRef.current?.(null);
      }
    });

    // Re-add layers after map style changes
    const onStyleLoad = () => {
      addSourceAndLayers();
    };
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      cancelAnimationFrame(rafRef.current);
      isAnimatingRef.current = false;
      try {
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(SELECTED_LAYER_ID)) map.removeLayer(SELECTED_LAYER_ID);
        if (map.getLayer(DEAD_LAYER_ID)) map.removeLayer(DEAD_LAYER_ID);
        if (map.getLayer(ALIVE_LAYER_ID)) map.removeLayer(ALIVE_LAYER_ID);
        if (map.getLayer(GLOW_LAYER_ID)) map.removeLayer(GLOW_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // Map may already be removed
      }
      popup.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, addSourceAndLayers]);

  // --- Smooth interpolation: when new units arrive, start lerping ---
  useEffect(() => {
    const lerpStates = lerpStatesRef.current;

    // Update lerp targets: capture current interpolated position as "prev",
    // set new server position as "target"
    for (const u of units) {
      if (u.lng === undefined || u.lat === undefined) continue;
      const existing = lerpStates.get(u.id);
      if (existing) {
        // Start from wherever the unit visually is right now
        existing.prevLng = existing.targetLng;
        existing.prevLat = existing.targetLat;
        existing.targetLng = u.lng;
        existing.targetLat = u.lat;
      } else {
        // First appearance — no lerp, just set directly
        lerpStates.set(u.id, {
          prevLng: u.lng,
          prevLat: u.lat,
          targetLng: u.lng,
          targetLat: u.lat,
        });
      }
    }

    // Start animation timer
    lerpStartRef.current = performance.now();

    // If not already animating, kick off the rAF loop
    if (!isAnimatingRef.current) {
      isAnimatingRef.current = true;
      const animate = () => {
        if (!isAnimatingRef.current) return;

        const elapsed = performance.now() - lerpStartRef.current;
        const t = Math.min(elapsed / LERP_DURATION_MS, 1);
        // Ease-out cubic for smooth deceleration
        const eased = 1 - Math.pow(1 - t, 3);

        const interpolated = new Map<number, { lng: number; lat: number }>();
        for (const [id, state] of lerpStates) {
          interpolated.set(id, {
            lng: state.prevLng + (state.targetLng - state.prevLng) * eased,
            lat: state.prevLat + (state.targetLat - state.prevLat) * eased,
          });
        }

        // Update GeoJSON source with interpolated positions
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (source) {
          source.setData(buildGeoJson(unitsRef.current, selectedRef.current, interpolated));
        }

        if (t < 1) {
          rafRef.current = requestAnimationFrame(animate);
        } else {
          // Animation complete — do one final update at exact target
          isAnimatingRef.current = false;
        }
      };
      rafRef.current = requestAnimationFrame(animate);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, units, selectedUnitId]);

  return null;
}
