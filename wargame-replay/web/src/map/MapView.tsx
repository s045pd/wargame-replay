import { useEffect, useRef, useState, useMemo } from 'react';
import * as mapboxgl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { UnitPosition } from '../lib/api';
import { UnitLayer } from './UnitLayer';
import { TrailLayer } from './TrailLayer';
import { BaseCampLayer } from './BaseCampLayer';
import { GraticuleLayer } from './GraticuleLayer';
import { BombingLayer } from './BombingLayer';
import { POILayer } from './POILayer';
import { HotspotLayer } from './HotspotLayer';
import { HotspotActivityCircle } from './HotspotActivityCircle';
import { SniperTracerLayer } from './SniperTracerLayer';
import { EventToastOverlay } from './EventToastOverlay';
import { KillLeaderboard } from './KillLeaderboard';
import { HotspotControlPanel } from './HotspotControlPanel';
import { getMapStyle, MapStyleKey } from './styles';
import { useDirector, TargetCamera } from '../store/director';
import { usePlayback } from '../store/playback';
import { useHotspotFilter } from '../store/hotspotFilter';
import { useI18n } from '../lib/i18n';

interface MapViewProps {
  units: UnitPosition[];
  targetCamera?: TargetCamera | null;
  immersive?: boolean;
}

export function MapView({ units, targetCamera: targetCameraProp, immersive = false }: MapViewProps) {
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
    styleNonce,
    trailEnabled,
    selectedUnitId,
    followSelectedUnit,
    manualFollow,
    setSelectedUnitId,
    setFollowSelectedUnit,
    setManualFollow,
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

  // Read targetCamera + activeHotspotId + focusMode + followZoom from director store
  const { targetCamera: directorCamera, activeHotspotId, autoMode, focusMode, mode } = useDirector();
  const targetCamera = targetCameraProp ?? directorCamera;

  // Find the hotspot currently being tracked for the map indicator
  // Hidden during manual follow — user is in full control
  const activeHotspot = useMemo(() => {
    if (!autoMode || activeHotspotId === null || manualFollow) return null;
    return allHotspots.find((hs) => hs.id === activeHotspotId) ?? null;
  }, [autoMode, activeHotspotId, allHotspots, manualFollow]);

  const currentStyleRef = useRef<MapStyleKey>(mapStyle);

  // Initialize map — guarded against StrictMode double-invocation
  useEffect(() => {
    if (!containerRef.current || initedRef.current) return;
    initedRef.current = true;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getMapStyle(mapStyle),
      center: [0, 20],
      zoom: 2,
      preserveDrawingBuffer: true,  // needed for video capture via captureStream()
    } as mapboxgl.MapOptions);

    mapRef.current = map;

    function onStyleReady() {
      if (mapReadyCalledRef.current) return;
      mapReadyCalledRef.current = true;

      // Ensure correct canvas size after container layout
      map.resize();

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

    // Cleanup: clear poll interval on unmount (map itself persists via initedRef guard)
    return () => {
      clearInterval(pollInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch map style when mapStyle or tile provider (token) changes
  useEffect(() => {
    if (!mapRef.current || !mapReady) return;
    // Skip if both key and nonce are unchanged (prevents redundant setStyle on mount)
    if (currentStyleRef.current === mapStyle && styleNonce === 0) return;

    currentStyleRef.current = mapStyle;
    mapRef.current.setStyle(getMapStyle(mapStyle));
  }, [mapStyle, mapReady, styleNonce]);

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
        // When director controls zoom (followZoom set), skip the initial flyTo —
        // the targetCamera effect already handles the smooth transition to the
        // correct zoom level, and firing a second flyTo causes conflicts.
        if (!followZoomedRef.current) {
          followZoomedRef.current = true;
          const dirZoom = useDirector.getState().followZoom;
          if (dirZoom === null) {
            // Manual follow (user clicked) — zoom in close
            const t = followTargetRef.current;
            if (t) {
              mapRef.current.flyTo({
                center: [t.lng, t.lat],
                zoom: 19,
                duration: 1200,
              });
            }
          }
        }

        // Exponential-chase rAF loop
        const LERP = 0.07; // lower = smoother but more lag  (0.05–0.10 sweet spot)
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

          // Only move if there's a meaningful delta (~0.1m, avoids sub-pixel jitter)
          if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
            map.setCenter([c.lng + dx * LERP, c.lat + dy * LERP]);
          }

          // Bidirectional zoom convergence toward director's target zoom.
          // When followZoom is set (by director), smoothly converge in BOTH
          // directions — zoom out for long_range, zoom in for killstreak.
          // When followZoom is null (manual follow), use 18 as minimum floor only.
          const dirZoom = useDirector.getState().followZoom;
          if (dirZoom !== null) {
            const curZoom = map.getZoom();
            if (Math.abs(curZoom - dirZoom) > 0.1) {
              map.setZoom(curZoom + (dirZoom - curZoom) * ZOOM_LERP);
            }
          } else {
            const curZoom = map.getZoom();
            if (curZoom < 18) {
              map.setZoom(curZoom + (18 - curZoom) * ZOOM_LERP);
            }
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
   
  }, [mapReady, followSelectedUnit, selectedUnitId]);

  const selectedUnit = useMemo(() =>
    selectedUnitId !== null ? units.find(u => u.id === selectedUnitId) : undefined,
    [units, selectedUnitId],
  );

  // Memoize team scoreboard counts — avoids 4 × O(n) filters every frame
  const teamCounts = useMemo(() => {
    let rA = 0, rT = 0, bA = 0, bT = 0;
    for (const u of units) {
      if (u.team === 'red') { rT++; if (u.alive) rA++; }
      else if (u.team === 'blue') { bT++; if (u.alive) bA++; }
    }
    return { redAlive: rA, redTotal: rT, blueAlive: bA, blueTotal: bT };
  }, [units]);

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
          {/* Sniper tracer — animated ray for long-range kills */}
          <SniperTracerLayer
            map={mapRef.current}
            hotspots={filteredHotspots}
            currentTs={currentTs}
          />
          {/* Battlefield POIs (control points, supply, vehicles) */}
          {pois && pois.length > 0 && (
            <POILayer
              map={mapRef.current}
              pois={pois}
            />
          )}
          {/* Debug overlay + control panel — director mode only, hidden in replay & immersive */}
          {mode === 'director' && !immersive && (
            <>
              {debugOverlay && filteredHotspots.length > 0 && (
                <HotspotLayer
                  map={mapRef.current}
                  hotspots={filteredHotspots}
                  currentTs={currentTs}
                />
              )}
              {debugOverlay && <HotspotActivityCircle map={mapRef.current} />}
              <HotspotControlPanel />
            </>
          )}
          <TrailLayer
            map={mapRef.current}
            units={units}
            trailEnabled={trailEnabled}
            events={events}
            selectedUnitId={followSelectedUnit ? selectedUnitId : null}
            focusMode={focusMode}
          />
          <UnitLayer
            map={mapRef.current}
            units={units}
            selectedUnitId={selectedUnitId}
            speed={speed}
            focusMode={focusMode}
            events={events}
            onSelectUnit={(id) => {
              setSelectedUnitId(id);
              if (id === null) setFollowSelectedUnit(false);
            }}
          />
          {/* Event toast overlay — kill/hit feed (hidden in immersive) */}
          {!immersive && <EventToastOverlay events={events} units={units} />}

          {/* Hotspot tracking indicator — when no unit selected, show standalone; otherwise merged below unit card */}
          {activeHotspot && !selectedUnit && (
            <div className={`absolute left-4 top-4 z-10 bg-zinc-900/90 border rounded px-3 py-1.5 text-xs font-mono backdrop-blur-sm pointer-events-none ${focusMode.active ? 'border-amber-500/80' : 'border-amber-700/60'}`}>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] ${focusMode.active ? 'text-amber-300 animate-pulse' : 'text-amber-400'}`}>●</span>
                <span className="text-amber-400 font-bold">{t(activeHotspot.type as string)}</span>
                {activeHotspot.focusName && (
                  <span className="text-zinc-200 font-medium">{activeHotspot.focusName}</span>
                )}
                {activeHotspot.kills > 0 && (
                  <span className="text-red-400">{activeHotspot.kills} 击杀</span>
                )}
                {activeHotspot.hits > 0 && (
                  <span className="text-orange-400">{activeHotspot.hits} 击中</span>
                )}
                {activeHotspot.type === 'long_range' && activeHotspot.distance && (
                  <span className="text-cyan-400">{activeHotspot.distance}m</span>
                )}
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

          {/* Team scoreboard - top right (hidden in immersive) */}
          {!immersive && units.length > 0 && (
              <div className="absolute top-4 right-14 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-3 py-2 text-xs font-mono backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                    <span className="text-red-400 font-bold">{teamCounts.redAlive}</span>
                    <span className="text-zinc-500">/{teamCounts.redTotal}</span>
                  </div>
                  <span className="text-zinc-600">vs</span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" />
                    <span className="text-cyan-400 font-bold">{teamCounts.blueAlive}</span>
                    <span className="text-zinc-500">/{teamCounts.blueTotal}</span>
                  </div>
                </div>
              </div>
          )}

          {/* Kill leaderboard — below scoreboard (hidden in immersive) */}
          {!immersive && <KillLeaderboard events={events} units={units} currentTs={currentTs} />}

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
                <span className="text-zinc-400 text-[10px]">{t((selectedUnit.class || 'rifle') as string)}</span>
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
                  <span className="text-zinc-500 w-6">{t('hp')}</span>
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
              {/* Ammo bar */}
              <div className="mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 w-6">{t('ammo')}</span>
                  <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, (selectedUnit.ammo / 255) * 100)}%`,
                        backgroundColor: selectedUnit.ammo > 100 ? '#3b82f6' : selectedUnit.ammo > 40 ? '#eab308' : '#ef4444',
                      }}
                    />
                  </div>
                  <span className="text-zinc-400 w-6 text-right">{selectedUnit.ammo}</span>
                </div>
              </div>
              {/* Supply + Revival tokens inline */}
              <div className="flex items-center gap-3 mb-1 text-zinc-400">
                <span><span className="text-zinc-500">{t('supply')}</span> {selectedUnit.supply}</span>
                <span><span className="text-zinc-500">{t('revival_tokens')}</span> {selectedUnit.revivalTokens}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const next = !followSelectedUnit;
                    setFollowSelectedUnit(next);
                    if (next) setManualFollow(true);
                  }}
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
              {/* Hotspot event details — shown below follow button when hotspot is active */}
              {activeHotspot && (
                <div className={`mt-2 pt-2 border-t ${focusMode.active ? 'border-amber-600/50' : 'border-zinc-700'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] ${focusMode.active ? 'text-amber-300 animate-pulse' : 'text-amber-400'}`}>●</span>
                    <span className="text-amber-400 font-bold">{t(activeHotspot.type as string)}</span>
                    {activeHotspot.type === 'long_range' && activeHotspot.distance && (
                      <span className="text-cyan-400">{activeHotspot.distance}m</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-zinc-300">
                    {activeHotspot.kills > 0 && (
                      <span><span className="text-red-400 font-bold">{activeHotspot.kills}</span> <span className="text-zinc-500">击杀</span></span>
                    )}
                    {activeHotspot.hits > 0 && (
                      <span><span className="text-orange-400 font-bold">{activeHotspot.hits}</span> <span className="text-zinc-500">击中</span></span>
                    )}
                    <span className="text-zinc-500 text-[10px] ml-auto">
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
