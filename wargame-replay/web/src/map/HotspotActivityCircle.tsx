import { useEffect, useRef, useCallback } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { HotspotEvent, UnitPosition } from '../lib/api';
import { useVisualConfig } from '../store/visualConfig';

const SOURCE_ID = 'hotspot-activity-circle';
const FILL_LAYER = 'hotspot-activity-fill';
const LINE_LAYER = 'hotspot-activity-line';

/** Type-based circle colours */
const TYPE_LINE_COLORS: Record<string, string> = {
  firefight: '#ff9900',
  killstreak: '#ff3322',
  mass_casualty: '#cc0000',
  engagement: '#ff8800',
  bombardment: '#ffee44',
  long_range: '#00ccff',
};

const EARTH_RADIUS = 6371000; // meters

/** Generate a GeoJSON circle polygon from center + radius in meters */
function geoCircle(
  centerLng: number,
  centerLat: number,
  radiusMeters: number,
  points = 64,
): GeoJSON.Feature {
  const coords: [number, number][] = [];
  const latRad = (centerLat * Math.PI) / 180;
  const dLat = (radiusMeters / EARTH_RADIUS) * (180 / Math.PI);
  const dLng = dLat / Math.cos(latRad);

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const lng = centerLng + dLng * Math.cos(angle);
    const lat = centerLat + dLat * Math.sin(angle);
    coords.push([lng, lat]);
  }

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {},
  };
}

/** Haversine distance in meters */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute bounding circle (center + radius) from alive involved units.
 * For killstreak: focus on killer + alive victims.
 * Excludes dead units (their positions after death are irrelevant).
 */
function computeActivityCircle(
  hotspot: HotspotEvent,
  frameUnits: UnitPosition[],
): { centerLat: number; centerLng: number; radiusMeters: number } | null {
  const unitIds = hotspot.units;
  if (!unitIds || unitIds.length === 0) return null;

  const idSet = new Set(unitIds);
  const positions: { lat: number; lng: number }[] = [];

  for (const u of frameUnits) {
    if (!idSet.has(u.id)) continue;
    if (u.lat === undefined || u.lng === undefined) continue;

    // For killstreak/long_range: include the focus unit always, only include alive others
    if ((hotspot.type === 'killstreak' || hotspot.type === 'long_range') && hotspot.focusUnitId) {
      if (u.id === hotspot.focusUnitId || u.alive) {
        positions.push({ lat: u.lat, lng: u.lng });
      }
    } else {
      // For group events: include all alive involved units
      if (u.alive) {
        positions.push({ lat: u.lat, lng: u.lng });
      }
    }
  }

  if (positions.length < 2) return null;

  // Compute centroid
  let sumLat = 0,
    sumLng = 0;
  for (const p of positions) {
    sumLat += p.lat;
    sumLng += p.lng;
  }
  const centerLat = sumLat / positions.length;
  const centerLng = sumLng / positions.length;

  // Find max distance from centroid
  let maxDist = 0;
  for (const p of positions) {
    const d = haversine(centerLat, centerLng, p.lat, p.lng);
    if (d > maxDist) maxDist = d;
  }

  // Minimum 50m, 20% padding + 20m buffer, capped at 300m
  const radiusMeters = Math.min(300, Math.max(50, maxDist * 1.2 + 20));

  return { centerLat, centerLng, radiusMeters };
}

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

interface HotspotActivityCircleProps {
  map: any; // mapboxgl.Map
}

/**
 * Renders a dynamic activity circle on the map for the currently auto-director
 * tracked hotspot. The circle encompasses all alive involved units and updates
 * every frame.
 */
export function HotspotActivityCircle({ map }: HotspotActivityCircleProps) {
  const { allHotspots, units, currentTs } = usePlayback();
  const { autoMode, activeHotspotId } = useDirector();

  const hotspotRef = useRef<HotspotEvent | null>(null);
  const unitsRef = useRef(units);
  const tsRef = useRef(currentTs);
  /** Cache last circle parameters to avoid regenerating 64-point polygon every frame */
  const lastCircleRef = useRef<{ lat: number; lng: number; r: number } | null>(null);
  const lastFeatureRef = useRef<GeoJSON.Feature | null>(null);
  unitsRef.current = units;
  tsRef.current = currentTs;

  // Find the active hotspot object
  const activeHotspot =
    autoMode && activeHotspotId !== null
      ? allHotspots.find((hs) => hs.id === activeHotspotId) ?? null
      : null;
  hotspotRef.current = activeHotspot;

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    const vc = useVisualConfig.getState();
    const hsColor = vc.hotspotCircleColor || '#ffa000';

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': hsColor,
        'fill-opacity': 0.08,
      },
    });

    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': hsColor,
        'line-width': 1.5,
        'line-opacity': 0.6,
        'line-dasharray': [4, 3],
      },
    });
  }, [map]);

  const updateSource = useCallback(() => {
    const source = map.getSource(SOURCE_ID) as any;
    if (!source) return;

    const hs = hotspotRef.current;
    if (!hs) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    // Check if hotspot is currently active
    const curMs = parseTs(tsRef.current);
    const hsStart = parseTs(hs.startTs);
    const hsEnd = parseTs(hs.endTs);
    if (curMs < hsStart || curMs > hsEnd) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const circle = computeActivityCircle(hs, unitsRef.current);
    if (!circle) {
      source.setData({ type: 'FeatureCollection', features: [] });
      lastCircleRef.current = null;
      return;
    }

    // Only regenerate 64-point polygon if center moved >5m or radius changed >5m
    const prev = lastCircleRef.current;
    let feature = lastFeatureRef.current;
    if (
      !prev || !feature ||
      Math.abs(circle.centerLat - prev.lat) > 0.00005 ||
      Math.abs(circle.centerLng - prev.lng) > 0.00005 ||
      Math.abs(circle.radiusMeters - prev.r) > 5
    ) {
      feature = geoCircle(circle.centerLng, circle.centerLat, circle.radiusMeters);
      lastCircleRef.current = { lat: circle.centerLat, lng: circle.centerLng, r: circle.radiusMeters };
      lastFeatureRef.current = feature;
    }
    source.setData({ type: 'FeatureCollection', features: [feature] });

    // Update color based on hotspot type (fall back to visualConfig hotspotCircleColor)
    const vcFallback = useVisualConfig.getState().hotspotCircleColor || '#ffa000';
    const lineColor = TYPE_LINE_COLORS[hs.type] || vcFallback;
    try {
      map.setPaintProperty(LINE_LAYER, 'line-color', lineColor);
      map.setPaintProperty(FILL_LAYER, 'fill-color', lineColor);
    } catch {
      // Layer might not exist yet
    }
  }, [map]);

  // Init + style reload
  useEffect(() => {
    addSourceAndLayers();
    const onStyleLoad = () => addSourceAndLayers();
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      try {
        if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
        if (map.getLayer(FILL_LAYER)) map.removeLayer(FILL_LAYER);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // ignore
      }
    };
  }, [map, addSourceAndLayers]);

  // Update every frame
  useEffect(() => {
    updateSource();
  }, [units, currentTs, activeHotspot, autoMode, updateSource]);

  return null;
}
