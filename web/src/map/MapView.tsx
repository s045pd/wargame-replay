import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { UnitPosition, UNIT_CLASS_LABELS, UnitClass } from '../lib/api';
import { UnitLayer } from './UnitLayer';
import { TrailLayer } from './TrailLayer';
import { HotspotLayer } from './HotspotLayer';
import { BaseCampLayer } from './BaseCampLayer';
import { GraticuleLayer } from './GraticuleLayer';
import { BombingLayer } from './BombingLayer';
import { POILayer } from './POILayer';
import { EventToastOverlay } from './EventToastOverlay';
import { MAP_STYLES, MapStyleKey } from './styles';
import { TargetCamera } from '../store/director';
import { usePlayback } from '../store/playback';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN_HERE';

interface MapViewProps {
  units: UnitPosition[];
  targetCamera?: TargetCamera | null;
}

export function MapView({ units, targetCamera }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const fittedRef = useRef(false);
  // Guard against StrictMode double-init: only create map once
  const initedRef = useRef(false);
  const mapReadyCalledRef = useRef(false);

  const {
    meta,
    currentTs,
    mapStyle,
    trailEnabled,
    selectedUnitId,
    followSelectedUnit,
    setSelectedUnitId,
    setFollowSelectedUnit,
    events,
    hotspot,
    pois,
  } = usePlayback();

  const currentStyleRef = useRef<MapStyleKey>(mapStyle);

  // Initialize map — guarded against StrictMode double-invocation
  useEffect(() => {
    if (!containerRef.current || initedRef.current) return;
    initedRef.current = true;

    mapboxgl.accessToken = MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLES[mapStyle],
      center: [0, 20],
      zoom: 2,
      projection: 'globe',
    });

    mapRef.current = map;

    function onStyleReady() {
      if (mapReadyCalledRef.current) return;
      mapReadyCalledRef.current = true;

      // Ensure correct canvas size after container layout
      map.resize();

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
      try {
        map.setFog({
          color: 'rgb(10, 10, 20)',
          'high-color': 'rgb(20, 30, 60)',
          'horizon-blend': 0.04,
          'space-color': 'rgb(0, 0, 10)',
          'star-intensity': 0.6,
        });
      } catch {
        // Fog not available
      }

      setMapReady(true);

      // Use meta bounds for immediate camera positioning (no waiting for frame data)
      const { meta } = usePlayback.getState();
      const bounds = meta?.bounds;
      if (bounds) {
        const padLat = Math.max((bounds.maxLat - bounds.minLat) * 0.15, 0.0003);
        const padLng = Math.max((bounds.maxLng - bounds.minLng) * 0.15, 0.0003);
        map.fitBounds(
          [[bounds.minLng - padLng, bounds.minLat - padLat],
           [bounds.maxLng + padLng, bounds.maxLat + padLat]],
          { animate: false, maxZoom: 20 },
        );
        fittedRef.current = true;
      }
    }

    // Multiple paths to detect style ready — StrictMode can prevent `load` from firing.
    map.on('load', onStyleReady);
    map.on('style.load', onStyleReady);

    // Fallback poll: check isStyleLoaded() periodically
    const pollInterval = setInterval(() => {
      if (mapReadyCalledRef.current) {
        clearInterval(pollInterval);
        return;
      }
      if (map.isStyleLoaded()) {
        clearInterval(pollInterval);
        onStyleReady();
      }
    }, 300);

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // No cleanup — map persists for the lifetime of this component mount.
    // StrictMode's double-invocation is handled by initedRef guard above.
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
          {/* Graticule grid — bottom layer */}
          {meta?.graticule && (
            <GraticuleLayer
              map={mapRef.current}
              graticule={meta.graticule}
              bounds={meta.bounds}
            />
          )}
          {/* Base camp markers */}
          {meta?.baseCamps && meta.baseCamps.length > 0 && (
            <BaseCampLayer
              map={mapRef.current}
              baseCamps={meta.baseCamps}
            />
          )}
          <HotspotLayer
            map={mapRef.current}
            hotspot={hotspot}
          />
          {/* Bombing events — timed markers */}
          {meta?.bombingEvents && meta.bombingEvents.length > 0 && (
            <BombingLayer
              map={mapRef.current}
              bombingEvents={meta.bombingEvents}
              currentTs={currentTs}
            />
          )}
          {/* Battlefield POIs (control points, supply, vehicles) */}
          {pois && pois.length > 0 && (
            <POILayer
              map={mapRef.current}
              pois={pois}
            />
          )}
          <TrailLayer
            map={mapRef.current}
            units={units}
            trailEnabled={trailEnabled}
            events={events}
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

          {/* Team scoreboard - top right */}
          {units.length > 0 && (() => {
            const redAlive = units.filter(u => u.team === 'red' && u.alive).length;
            const redTotal = units.filter(u => u.team === 'red').length;
            const blueAlive = units.filter(u => u.team === 'blue' && u.alive).length;
            const blueTotal = units.filter(u => u.team === 'blue').length;
            return (
              <div className="absolute top-4 right-14 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-3 py-2 text-xs font-mono backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                    <span className="text-red-400 font-bold">{redAlive}</span>
                    <span className="text-zinc-500">/{redTotal}</span>
                  </div>
                  <span className="text-zinc-600">vs</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
                    <span className="text-cyan-400 font-bold">{blueAlive}</span>
                    <span className="text-zinc-500">/{blueTotal}</span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Selected unit info panel */}
          {selectedUnit && (
            <div className="absolute top-4 left-4 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-zinc-200 backdrop-blur-sm min-w-[200px]">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full inline-block"
                  style={{
                    backgroundColor: selectedUnit.team === 'red' ? '#ff4444' : selectedUnit.team === 'blue' ? '#00ccff' : '#aaaaaa',
                  }}
                />
                <span className="font-bold">{selectedUnit.name || `#${selectedUnit.id}`}</span>
                <span className="text-zinc-500">({selectedUnit.team})</span>
                <span className="text-zinc-400 text-[10px]">{UNIT_CLASS_LABELS[(selectedUnit.class || 'rifle') as UnitClass]}</span>
                <button
                  className="ml-auto text-zinc-500 hover:text-zinc-200 text-xs"
                  onClick={() => {
                    setSelectedUnitId(null);
                    setFollowSelectedUnit(false);
                  }}
                  title="Deselect"
                >
                  ×
                </button>
              </div>
              {/* HP bar */}
              <div className="mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">HP</span>
                  <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(selectedUnit.hp / 100) * 100}%`,
                        backgroundColor: selectedUnit.hp > 40 ? '#22c55e' : selectedUnit.hp > 20 ? '#eab308' : '#ef4444',
                      }}
                    />
                  </div>
                  <span className="text-zinc-400 w-6 text-right">{selectedUnit.hp}</span>
                </div>
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
                  <span className="text-red-500 text-xs font-bold">KIA</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
