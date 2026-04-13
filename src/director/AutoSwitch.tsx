import { useEffect, useRef } from 'react';
import { useDirector } from '../store/director';
import { useI18n } from '../lib/i18n';

const SWITCH_COOLDOWN_MS = 6000;

/**
 * AutoSwitch — pure UI component for the director sidebar.
 * Displays the auto-director toggle, hotspot score bar, and countdown timer.
 *
 * All camera-switching, score-setting, and hotspot tracking logic lives in
 * useHotspotDirector (the single source of truth). This component only reads
 * from the director store and renders controls.
 */
export function AutoSwitch() {
  const {
    autoMode,
    toggleAutoMode,
    hotspotScore,
    nextSwitchCountdown,
    lastSwitchTime,
    setNextSwitchCountdown,
    switchLocked,
  } = useDirector();
  const { t } = useI18n();

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      <div className="text-xs text-zinc-500 uppercase tracking-wider">{t('auto_director')}</div>

      <button
        onClick={toggleAutoMode}
        className={`w-full py-1.5 text-xs font-medium rounded transition-colors ${
          autoMode
            ? 'bg-amber-600 hover:bg-amber-500 text-white'
            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
        }`}
      >
        {autoMode ? t('auto_on') : t('auto_off')}
      </button>

      <div>
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>{t('hotspot')}</span>
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
      </div>

      {autoMode && (
        <>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-500">{t('next_switch')}</span>
            <span className={`font-mono ${switchLocked ? 'text-amber-400' : 'text-zinc-300'}`}>
              {switchLocked ? `🔒 ${t('locked')}` : nextSwitchCountdown > 0 ? `${nextSwitchCountdown}s` : t('ready')}
            </span>
          </div>

        </>
      )}
    </div>
  );
}
