import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { UnitPosition } from '../lib/api';
import { UnitLayer } from './UnitLayer';
import { TrailLayer } from './TrailLayer';
import { EventToastOverlay } from './EventToastOverlay';
import { MAP_STYLES, MapStyleKey } from './styles';
import { TargetCamera } from '../store/director';
import { usePlayback } from '../store/playback';

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

  const {
    mapStyle,
    trailEnabled,
    selectedUnitId,
    followSelectedUnit,
    setSelectedUnitId,
    setFollowSelectedUnit,
    events,
  } = usePlayback();

  const currentStyleRef = useRef<MapStyleKey>(mapStyle);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLES[mapStyle],
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch map style when mapStyle changes
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    if (currentStyleRef.current === mapStyle) return;

    currentStyleRef.current = mapStyle;
    mapRef.current.setStyle(MAP_STYLES[mapStyle]);

    // After style loads, restore terrain + fog
    mapRef.current.once('style.load', () => {
      const map = mapRef.current;
      if (!map) return;
      try {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          });
          map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
        }
      } catch {
        // Terrain not available for this style
      }
      try {
        map.setFog({
          color: 'rgb(10, 10, 20)',
          'high-color': 'rgb(20, 30, 60)',
          'horizon-blend': 0.04,
          'space-color': 'rgb(0, 0, 10)',
          'star-intensity': 0.6,
        });
      } catch {
        // Fog not available for this style
      }
    });
  }, [mapStyle, mapReady]);

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

  // Follow selected unit when enabled
  useEffect(() => {
    if (!mapRef.current || !mapReady || !followSelectedUnit || selectedUnitId === null) return;
    const selected = units.find(u => u.id === selectedUnitId && u.alive);
    if (!selected || selected.lng === undefined || selected.lat === undefined) return;

    mapRef.current.easeTo({
      center: [selected.lng, selected.lat],
      duration: 300,
    });
  }, [units, mapReady, followSelectedUnit, selectedUnitId]);

  const selectedUnit = selectedUnitId !== null
    ? units.find(u => u.id === selectedUnitId)
    : undefined;

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="w-full h-full" />
      {mapReady && mapRef.current && (
        <>
          <TrailLayer
            map={mapRef.current}
            units={units}
            trailEnabled={trailEnabled}
          />
          <UnitLayer
            map={mapRef.current}
            units={units}
            selectedUnitId={selectedUnitId}
            onSelectUnit={(id) => {
              setSelectedUnitId(id);
              if (id === null) setFollowSelectedUnit(false);
            }}
          />
          <EventToastOverlay events={events} />

          {/* Selected unit info panel */}
          {selectedUnit && (
            <div className="absolute top-4 left-4 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-200 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{
                    backgroundColor: selectedUnit.team === 'red' ? '#ff4444' : selectedUnit.team === 'blue' ? '#00ccff' : '#aaaaaa',
                  }}
                />
                <span className="font-bold">Unit {selectedUnit.id}</span>
                <span className="text-zinc-500">({selectedUnit.team})</span>
                <button
                  className="ml-2 text-zinc-500 hover:text-zinc-200 text-xs"
                  onClick={() => {
                    setSelectedUnitId(null);
                    setFollowSelectedUnit(false);
                  }}
                  title="Deselect"
                >
                  ×
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFollowSelectedUnit(!followSelectedUnit)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    followSelectedUnit
                      ? 'bg-cyan-700 text-white'
                      : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                  }`}
                  title="Follow this unit"
                >
                  {followSelectedUnit ? 'Following' : 'Follow'}
                </button>
                {!selectedUnit.alive && (
                  <span className="text-red-500 text-xs">DEAD</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
