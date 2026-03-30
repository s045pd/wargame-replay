import { useEffect, useRef } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';

const AUTO_SWITCH_THRESHOLD = 0.3;
const SWITCH_COOLDOWN_MS = 5000;

export function AutoSwitch() {
  const { hotspot } = usePlayback();
  const {
    autoMode,
    toggleAutoMode,
    hotspotScore,
    nextSwitchCountdown,
    lastSwitchTime,
    setTargetCamera,
    setHotspotScore,
    setNextSwitchCountdown,
    recordSwitch,
  } = useDirector();

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Update hotspot score from playback
  useEffect(() => {
    if (hotspot) {
      setHotspotScore(hotspot.score);
    } else {
      setHotspotScore(0);
    }
  }, [hotspot, setHotspotScore]);

  // Auto-switch logic
  useEffect(() => {
    if (!autoMode || !hotspot) return;
    if (hotspot.score < AUTO_SWITCH_THRESHOLD) return;

    const now = Date.now();
    const timeSinceLastSwitch = now - lastSwitchTime;
    if (timeSinceLastSwitch < SWITCH_COOLDOWN_MS) return;

    // Trigger camera switch to hotspot center
    const [cx, cy] = hotspot.center;
    setTargetCamera({ x: cx, y: cy, zoom: 8 });
    recordSwitch();
  }, [autoMode, hotspot, lastSwitchTime, setTargetCamera, recordSwitch]);

  // Countdown ticker
  useEffect(() => {
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    if (!autoMode) {
      setNextSwitchCountdown(0);
      return;
    }

    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - lastSwitchTime;
      const remaining = Math.max(0, SWITCH_COOLDOWN_MS - elapsed);
      setNextSwitchCountdown(Math.ceil(remaining / 1000));
    }, 250);

    return () => {
      if (countdownRef.current !== null) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [autoMode, lastSwitchTime, setNextSwitchCountdown]);

  const scorePercent = Math.min(100, Math.round(hotspotScore * 100));

  return (
    <div className="space-y-3">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">Auto Switch</div>

      {/* Toggle */}
      <button
        onClick={toggleAutoMode}
        className={`w-full py-1.5 text-xs font-medium rounded transition-colors ${
          autoMode
            ? 'bg-amber-600 hover:bg-amber-500 text-white'
            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
        }`}
      >
        {autoMode ? 'Auto: ON' : 'Auto: OFF'}
      </button>

      {/* Hotspot score bar */}
      <div>
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>Hotspot</span>
          <span>{scorePercent}%</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              scorePercent >= 30 ? 'bg-amber-500' : 'bg-zinc-600'
            }`}
            style={{ width: `${scorePercent}%` }}
          />
        </div>
        {scorePercent >= 30 && (
          <div className="text-xs text-amber-400 mt-1">Above threshold</div>
        )}
      </div>

      {/* Countdown */}
      {autoMode && (
        <div className="flex justify-between text-xs">
          <span className="text-zinc-500">Next switch in</span>
          <span className="text-zinc-300 font-mono">
            {nextSwitchCountdown > 0 ? `${nextSwitchCountdown}s` : 'Ready'}
          </span>
        </div>
      )}
    </div>
  );
}
