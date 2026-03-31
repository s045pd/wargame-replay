import { useEffect, useRef, useState, useMemo } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { UnitPosition, UNIT_CLASS_LABELS, UnitClass } from '../lib/api';
import { UnitLayer } from './UnitLayer';
import { TrailLayer } from './TrailLayer';
import { BaseCampLayer } from './BaseCampLayer';
import { GraticuleLayer } from './GraticuleLayer';
import { BombingLayer } from './BombingLayer';
import { POILayer } from './POILayer';
import { HotspotLayer } from './HotspotLayer';
import { HotspotActivityCircle } from './HotspotActivityCircle';
import { EventToastOverlay } from './EventToastOverlay';
import { KillLeaderboard } from './KillLeaderboard';
import { HotspotControlPanel } from './HotspotControlPanel';
import { MAP_STYLES, MapStyleKey } from './styles';
import { useDirector, TargetCamera } from '../store/director';
import { usePlayback } from '../store/playback';
import { useHotspotFilter } from '../store/hotspotFilter';
import { useI18n } from '../lib/i18n';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN_HERE';

interface MapViewProps {
  units: UnitPosition[];
  targetCamera?: TargetCamera | null;
}

export function MapView({ units, targetCamera: targetCameraProp }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const fittedRef = useRef(false);
  const initedRef = useRef(false);
  const mapReadyCalledRef = useRef(false);
  const { t } = useI18n();

  const {
    meta,
    currentTs,
    speed,
    mapStyle,
    trailEnabled,
    selectedUnitId,
    followSelectedUnit,
    setSelectedUnitId,
    setFollowSelectedUnit,
    events,
    pois,
    allHotspots,
  } = usePlayback();

  const { debugOverlay, typeFilters } = useHotspotFilter();

  // Filter allHotspots by enabled type filters for debug overlay
  const filteredHotspots = useMemo(
    () => allHotspots.filter((hs) => typeFilters[hs.type as keyof typeof typeFilters]),
    [allHotspots, typeFilters],
  );

  // Read targetCamera + activeHotspotId from director store
  const { targetCamera: directorCamera, activeHotspotId, autoMode } = useDirector();
  const targetCamera = targetCameraProp ?? directorCamera;

  // Find the hotspot currently being tracked for the map indicator
  const activeHotspot = useMemo(() => {
    if (!autoMode || activeHotspotId === null) return null;
    return allHotspots.find((hs) => hs.id === activeHotspotId) ?? null;
  }, [autoMode, activeHotspotId, allHotspots]);

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
      preserveDrawingBuffer: true,  // needed for video capture via captureStream()
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

      // 3D building extrusions
      try {
        map.addLayer({
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': '#1a1a2e',
            'fill-extrusion-height': [
              'interpolate', ['linear'], ['zoom'],
              14, 0,
              15.05, ['get', 'height'],
            ],
            'fill-extrusion-base': [
              'interpolate', ['linear'], ['zoom'],
              14, 0,
              15.05, ['get', 'min_height'],
            ],
            'fill-extrusion-opacity': 0.5,
          },
        });
      } catch {
        // Building source not available in this style
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
      // Restore 3D buildings
      try {
        if (!map.getLayer('3d-buildings')) {
          map.addLayer({
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#1a1a2e',
              'fill-extrusion-height': [
                'interpolate', ['linear'], ['zoom'],
                14, 0, 15.05, ['get', 'height'],
              ],
              'fill-extrusion-base': [
                'interpolate', ['linear'], ['zoom'],
                14, 0, 15.05, ['get', 'min_height'],
              ],
              'fill-extrusion-opacity': 0.5,
            },
          });
        }
      } catch {
        // Building source not available
      }
    });
  }, [mapStyle, mapReady]);

  // Fly to director target camera (supports both point+zoom and bounds)
  useEffect(() => {
    if (!mapRef.current || !mapReady || !targetCamera) return;

    if (targetCamera.bounds) {
      // Use fitBounds for dynamic area-based zoom
      mapRef.current.fitBounds(targetCamera.bounds, {
        padding: 60,
        duration: 1500,
        maxZoom: 18,
        minZoom: 15,
      });
    } else if (targetCamera.lng !== undefined && targetCamera.lat !== undefined) {
      const center = mapRef.current.getCenter();
      const dlng = Math.abs(targetCamera.lng - center.lng);
      const dlat = Math.abs(targetCamera.lat - center.lat);
      const dist = Math.max(dlng, dlat);
      const targetZoom = targetCamera.zoom ?? mapRef.current.getZoom();

      if (dist < 0.005) {
        // Very close (~500m) — snap-smooth, minimal duration
        mapRef.current.easeTo({
          center: [targetCamera.lng, targetCamera.lat],
          zoom: targetZoom,
          duration: 600,
        });
      } else if (dist < 0.05) {
        // Medium distance (~5km) — smooth pan without zoom-out arc
        mapRef.current.easeTo({
          center: [targetCamera.lng, targetCamera.lat],
          zoom: targetZoom,
          duration: 1200,
        });
      } else {
        // Far jump — use flyTo but constrain the arc so it doesn't zoom
        // out to the world view. minZoom keeps the camera close.
        mapRef.current.flyTo({
          center: [targetCamera.lng, targetCamera.lat],
          zoom: targetZoom,
          duration: 2000,
          minZoom: Math.min(mapRef.current.getZoom(), targetZoom) - 2,
        });
      }
    }
  }, [targetCamera, mapReady]);

  // --- Smooth camera follow via rAF exponential chase ---
  // Instead of calling easeTo() per frame (which causes jitter), we maintain
  // a target ref and run a 60fps loop that smoothly lerps the camera center.
  const followTargetRef = useRef<{ lng: number; lat: number } | null>(null);
  const followRafRef = useRef<number>(0);
  const followActiveRef = useRef(false);
  const followZoomedRef = useRef(false);

  // Reset zoom flag when follow target changes so camera re-zooms to the new unit
  const prevFollowIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (followSelectedUnit && selectedUnitId !== null && selectedUnitId !== prevFollowIdRef.current) {
      followZoomedRef.current = false;
    }
    prevFollowIdRef.current = followSelectedUnit ? selectedUnitId : null;
  }, [followSelectedUnit, selectedUnitId]);

  // Update target position whenever unit data changes
  useEffect(() => {
    if (!followSelectedUnit || selectedUnitId === null) {
      followTargetRef.current = null;
      return;
    }
    const selected = units.find(u => u.id === selectedUnitId);
    if (selected?.lng !== undefined && selected?.lat !== undefined) {
      followTargetRef.current = { lng: selected.lng, lat: selected.lat };
    }
  }, [units, followSelectedUnit, selectedUnitId]);

  // Start / stop the smooth follow loop
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;

    if (followSelectedUnit && selectedUnitId !== null) {
      // --- Activate follow ---
      if (!followActiveRef.current) {
        followActiveRef.current = true;

        // Initial zoom-in on first activation
        if (!followZoomedRef.current) {
          followZoomedRef.current = true;
          const t = followTargetRef.current;
          if (t) {
            mapRef.current.flyTo({
              center: [t.lng, t.lat],
              zoom: 19,
              duration: 1200,
            });
          }
        }

        // Exponential-chase rAF loop
        const LERP = 0.07; // lower = smoother but more lag  (0.05–0.10 sweet spot)
        const MIN_FOLLOW_ZOOM = 18; // minimum zoom during follow — keeps the action visible
        const ZOOM_LERP = 0.03;     // smooth zoom-in speed
        const chase = () => {
          if (!followActiveRef.current) return;
          const map = mapRef.current;
          const target = followTargetRef.current;
          if (!map || !target) {
            followRafRef.current = requestAnimationFrame(chase);
            return;
          }

          const c = map.getCenter();
          const dx = target.lng - c.lng;
          const dy = target.lat - c.lat;

          // Only move if there's a meaningful delta (avoids sub-pixel jitter)
          if (Math.abs(dx) > 1e-8 || Math.abs(dy) > 1e-8) {
            map.setCenter([c.lng + dx * LERP, c.lat + dy * LERP]);
          }

          // Maintain minimum zoom — smoothly pull in if camera is too far out
          const curZoom = map.getZoom();
          if (curZoom < MIN_FOLLOW_ZOOM) {
            map.setZoom(curZoom + (MIN_FOLLOW_ZOOM - curZoom) * ZOOM_LERP);
          }

          followRafRef.current = requestAnimationFrame(chase);
        };
        followRafRef.current = requestAnimationFrame(chase);
      }
    } else {
      // --- Deactivate follow ---
      followActiveRef.current = false;
      followZoomedRef.current = false;
      cancelAnimationFrame(followRafRef.current);
    }

    return () => {
      followActiveRef.current = false;
      cancelAnimationFrame(followRafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, followSelectedUnit, selectedUnitId]);

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
          {/* Debug overlay — hotspot circles on map (toggled via control panel) */}
          {debugOverlay && filteredHotspots.length > 0 && (
            <HotspotLayer
              map={mapRef.current}
              hotspots={filteredHotspots}
              currentTs={currentTs}
            />
          )}
          {/* Activity circle — dynamic bounding area for auto-director tracked hotspot */}
          {debugOverlay && <HotspotActivityCircle map={mapRef.current} />}
          {/* Hotspot control panel — debug overlay toggle + type filters */}
          <HotspotControlPanel />
          <TrailLayer
            map={mapRef.current}
            units={units}
            trailEnabled={trailEnabled}
            events={events}
            selectedUnitId={followSelectedUnit ? selectedUnitId : null}
          />
          <UnitLayer
            map={mapRef.current}
            units={units}
            selectedUnitId={selectedUnitId}
            speed={speed}
            onSelectUnit={(id) => {
              setSelectedUnitId(id);
              if (id === null) setFollowSelectedUnit(false);
            }}
          />
          <EventToastOverlay events={events} units={units} />

          {/* Hotspot tracking indicator — positioned below unit info panel to avoid overlap */}
          {activeHotspot && (
            <div className={`absolute left-4 z-10 bg-zinc-900/90 border border-amber-700/60 rounded px-3 py-1.5 text-xs font-mono backdrop-blur-sm pointer-events-none ${selectedUnit ? 'top-28' : 'top-4'}`}>
              <div className="flex items-center gap-2">
                <span className="text-amber-400 text-[10px]">●</span>
                <span className="text-zinc-200 font-medium">
                  {activeHotspot.type === 'killstreak' && activeHotspot.focusName
                    ? `${activeHotspot.focusName} ${activeHotspot.label}`
                    : activeHotspot.label}
                </span>
                <span className="text-zinc-500 text-[10px]">
                  {(() => {
                    const s = new Date(activeHotspot.startTs.replace(' ', 'T')).getTime();
                    const e = new Date(activeHotspot.endTs.replace(' ', 'T')).getTime();
                    const durSec = Math.round((e - s) / 1000);
                    if (durSec >= 60) return `${Math.floor(durSec / 60)}m${durSec % 60}s`;
                    return `${durSec}s`;
                  })()}
                </span>
              </div>
            </div>
          )}

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

          {/* Kill leaderboard — below scoreboard */}
          <KillLeaderboard events={events} units={units} currentTs={currentTs} />

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
                  {followSelectedUnit ? t('following') : t('follow')}
                </button>
                {!selectedUnit.alive && (
                  <span className="text-red-500 text-xs font-bold">{t('kia')}</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
