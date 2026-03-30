import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { UnitPosition } from '../lib/api';
import { UnitLayer } from './UnitLayer';
import { MAP_STYLES } from './styles';
import { TargetCamera } from '../store/director';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN_HERE';

interface MapViewProps {
  units: UnitPosition[];
  targetCamera?: TargetCamera | null;
}

function computeBounds(units: UnitPosition[]): mapboxgl.LngLatBoundsLike | null {
  const geo = units.filter(u => u.lng !== undefined && u.lat !== undefined);
  if (geo.length === 0) return null;

  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  for (const u of geo) {
    if (u.lng! < minLng) minLng = u.lng!;
    if (u.lng! > maxLng) maxLng = u.lng!;
    if (u.lat! < minLat) minLat = u.lat!;
    if (u.lat! > maxLat) maxLat = u.lat!;
  }

  // Add some padding
  const padLng = Math.max((maxLng - minLng) * 0.1, 0.01);
  const padLat = Math.max((maxLat - minLat) * 0.1, 0.01);

  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
  ];
}

export function MapView({ units, targetCamera }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLES.dark,
      center: [0, 20],
      zoom: 2,
      projection: 'globe',
    });

    mapRef.current = map;

    map.on('load', () => {
      // Add 3D terrain if supported
      try {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      } catch {
        // Terrain not available, continue without it
      }

      // Atmosphere for globe projection
      map.setFog({
        color: 'rgb(10, 10, 20)',
        'high-color': 'rgb(20, 30, 60)',
        'horizon-blend': 0.04,
        'space-color': 'rgb(0, 0, 10)',
        'star-intensity': 0.6,
      });

      setMapReady(true);
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
      fittedRef.current = false;
    };
  }, []);

  // Fit bounds once we have unit positions
  useEffect(() => {
    if (!mapRef.current || !mapReady || fittedRef.current) return;
    if (units.length === 0) return;

    const bounds = computeBounds(units);
    if (bounds) {
      mapRef.current.fitBounds(bounds, { padding: 60, duration: 1500 });
      fittedRef.current = true;
    }
  }, [units, mapReady]);

  // Fly to director target camera
  useEffect(() => {
    if (!mapRef.current || !mapReady || !targetCamera) return;
    if (targetCamera.lng !== undefined && targetCamera.lat !== undefined) {
      mapRef.current.flyTo({
        center: [targetCamera.lng, targetCamera.lat],
        zoom: targetCamera.zoom ?? 8,
        duration: 1500,
      });
    }
  }, [targetCamera, mapReady]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
      {mapReady && mapRef.current && (
        <UnitLayer map={mapRef.current} units={units} />
      )}
    </div>
  );
}
