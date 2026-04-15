import { Play, Pause, SkipForward, SkipBack, ChevronDown } from 'lucide-react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useI18n } from '../lib/i18n';

const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] as const;

/** Parse a DB timestamp "YYYY-MM-DD HH:MM:SS" as a local Date */
function parseDbTs(ts: string): Date {
  return new Date(ts.replace(' ', 'T'));
}

/** Format a DB timestamp string as HH:MM:SS (local time) */
function formatTime(ts: string): string {
  if (!ts) return '--:--:--';
  const d = parseDbTs(ts);
  if (isNaN(d.getTime())) return '--:--:--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Format a Date back to "YYYY-MM-DD HH:MM:SS" in local time (matching DB format) */
function toDbTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Add seconds to a DB timestamp string, clamped to [min, max] */
function addSeconds(ts: string, seconds: number, min: string, max: string): string {
  const d = parseDbTs(ts);
  d.setSeconds(d.getSeconds() + seconds);
  const minD = parseDbTs(min);
  const maxD = parseDbTs(max);
  const clamped = new Date(Math.max(minD.getTime(), Math.min(maxD.getTime(), d.getTime())));
  return toDbTs(clamped);
}

export function TransportControls() {
  const {
    playing, speed, currentTs, meta, play, pause, seek, setSpeed,
    trailEnabled, setTrailEnabled,
    killLineEnabled, setKillLineEnabled,
    hitLineEnabled, setHitLineEnabled,
    reviveEffectEnabled, setReviveEffectEnabled,
    healEffectEnabled, setHealEffectEnabled,
    hitFeedbackEnabled, setHitFeedbackEnabled,
    deathEffectEnabled, setDeathEffectEnabled,
    killstreakSlowDiv, setKillstreakSlowDiv,
    longRangeSlowSpeed, setLongRangeSlowSpeed,
    bombardSlowDiv, setBombardSlowDiv,
  } = usePlayback();
  const { focusDarkMap, toggleFocusDarkMap } = useDirector();
  const { t } = useI18n();

  const handleSkip = (delta: number) => {
    if (!meta) return;
    const next = addSeconds(currentTs, delta, meta.startTime, meta.endTime);
    seek(next);
  };

  const handlePlayPause = () => {
    if (playing) {
      pause();
    } else {
      play();
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 h-10 bg-zinc-900 border-t border-zinc-800 shrink-0">
      {/* Skip back */}
      <button
        onClick={() => handleSkip(-30)}
        title="Skip back 30s"
        className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        <SkipBack size={16} />
      </button>

      {/* Play/Pause */}
      <button
        onClick={handlePlayPause}
        title={playing ? 'Pause' : 'Play'}
        className="p-1 text-zinc-100 hover:text-white transition-colors"
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>

      {/* Skip forward */}
      <button
        onClick={() => handleSkip(30)}
        title="Skip forward 30s"
        className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        <SkipForward size={16} />
      </button>

      {/* Divider */}
      <div className="h-4 w-px bg-zinc-700" />

      {/* Current time display */}
      <span className="text-xs font-mono text-zinc-300 min-w-[6rem]">
        {formatTime(currentTs)}
      </span>

      {/* Speed selector */}
      <div className="relative ml-auto flex items-center gap-1">
        <span className="text-xs text-zinc-500">{t('speed')}</span>
        <div className="relative">
          <select
            value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
            className="appearance-none bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 rounded px-2 pr-5 py-0.5 cursor-pointer hover:bg-zinc-700 focus:outline-none"
          >
            {SPEEDS.map(s => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400"
          />
        </div>
      </div>

      {/* Divider before effect toggles */}
      <div className="h-4 w-px bg-zinc-700" />

      {/* Effect toggle buttons — styled like top bar */}
      <div className="flex items-center gap-1" title={t('fx_group_tip')}>
        <span className="text-[10px] text-zinc-500 mr-0.5">{t('fx_group')}</span>
        {/* Master trail toggle */}
        <button
          onClick={() => setTrailEnabled(!trailEnabled)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            trailEnabled ? 'bg-purple-700 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={`${t('fx_trail')} — ${trailEnabled ? 'ON' : 'OFF'}（${t('fx_kill_line')}/${t('fx_hit_line')}）`}
        >
          {t('fx_trail')}
        </button>
        {/* Kill line — subordinate to trail */}
        <button
          onClick={() => { if (trailEnabled) setKillLineEnabled(!killLineEnabled); }}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            !trailEnabled
              ? 'bg-zinc-800/50 text-zinc-700 cursor-not-allowed'
              : killLineEnabled
                ? 'bg-red-800 text-red-200'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={!trailEnabled ? `${t('fx_kill_line')} — ${t('fx_trail')} OFF` : `${t('fx_kill_line')} — ${killLineEnabled ? 'ON' : 'OFF'}`}
        >
          {t('fx_kill_line')}
        </button>
        {/* Hit line — subordinate to trail */}
        <button
          onClick={() => { if (trailEnabled) setHitLineEnabled(!hitLineEnabled); }}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            !trailEnabled
              ? 'bg-zinc-800/50 text-zinc-700 cursor-not-allowed'
              : hitLineEnabled
                ? 'bg-orange-800 text-orange-200'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={!trailEnabled ? `${t('fx_hit_line')} — ${t('fx_trail')} OFF` : `${t('fx_hit_line')} — ${hitLineEnabled ? 'ON' : 'OFF'}`}
        >
          {t('fx_hit_line')}
        </button>

        <div className="h-3 w-px bg-zinc-700/50" />

        {/* Death effect */}
        <button
          onClick={() => setDeathEffectEnabled(!deathEffectEnabled)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            deathEffectEnabled ? 'bg-red-900 text-red-300' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={`${t('fx_death')} — ${deathEffectEnabled ? 'ON' : 'OFF'}`}
        >
          {t('fx_death')}
        </button>
        {/* Revive effect */}
        <button
          onClick={() => setReviveEffectEnabled(!reviveEffectEnabled)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            reviveEffectEnabled ? 'bg-green-800 text-green-200' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={`${t('fx_revive')} — ${reviveEffectEnabled ? 'ON' : 'OFF'}`}
        >
          {t('fx_revive')}
        </button>
        {/* Heal effect */}
        <button
          onClick={() => setHealEffectEnabled(!healEffectEnabled)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            healEffectEnabled ? 'bg-emerald-800 text-emerald-200' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={`${t('fx_heal')} — ${healEffectEnabled ? 'ON' : 'OFF'}`}
        >
          {t('fx_heal')}
        </button>
        {/* Hit feedback */}
        <button
          onClick={() => setHitFeedbackEnabled(!hitFeedbackEnabled)}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            hitFeedbackEnabled ? 'bg-amber-800 text-amber-200' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={`${t('fx_hit_feedback')} — ${hitFeedbackEnabled ? 'ON' : 'OFF'}`}
        >
          {t('fx_hit_feedback')}
        </button>

        <div className="h-3 w-px bg-zinc-700/50" />

        {/* Focus dark map toggle */}
        <button
          onClick={toggleFocusDarkMap}
          className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
            focusDarkMap ? 'bg-indigo-800 text-indigo-200' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-500'
          }`}
          title={`${t('focus_dark_map')} — ${focusDarkMap ? 'ON' : 'OFF'}`}
        >
          {t('focus_dark_map')}
        </button>
      </div>

      {/* Slowdown settings */}
      <div className="h-4 w-px bg-zinc-700" />
      <div className="flex items-center gap-1" title={t('slow_group_tip')}>
        <span className="text-[10px] text-zinc-500 mr-0.5">{t('slow_group')}</span>
        {/* Killstreak divisor */}
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] text-zinc-600">{t('slow_killstreak')}</span>
          <select
            value={killstreakSlowDiv}
            onChange={e => setKillstreakSlowDiv(Number(e.target.value))}
            className="appearance-none bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 rounded px-1 py-0 cursor-pointer hover:bg-zinc-700 focus:outline-none"
          >
            <option value={0}>{t('slow_off')}</option>
            <option value={2}>÷2</option>
            <option value={4}>÷4</option>
            <option value={8}>÷8</option>
            <option value={16}>÷16</option>
          </select>
        </div>
        {/* Long-range target speed */}
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] text-zinc-600">{t('slow_longrange')}</span>
          <select
            value={longRangeSlowSpeed}
            onChange={e => setLongRangeSlowSpeed(Number(e.target.value))}
            className="appearance-none bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 rounded px-1 py-0 cursor-pointer hover:bg-zinc-700 focus:outline-none"
          >
            <option value={0}>{t('slow_off')}</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={4}>4x</option>
            <option value={8}>8x</option>
          </select>
        </div>
        {/* Bombardment divisor */}
        <div className="flex items-center gap-0.5">
          <span className="text-[10px] text-zinc-600">{t('slow_bombard')}</span>
          <select
            value={bombardSlowDiv}
            onChange={e => setBombardSlowDiv(Number(e.target.value))}
            className="appearance-none bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 rounded px-1 py-0 cursor-pointer hover:bg-zinc-700 focus:outline-none"
          >
            <option value={0}>{t('slow_off')}</option>
            <option value={2}>÷2</option>
            <option value={4}>÷4</option>
            <option value={8}>÷8</option>
          </select>
        </div>
      </div>

      {/* H key hint */}
      <span className="text-[10px] text-zinc-600 hidden sm:block">{t('immersive_hint')}</span>
    </div>
  );
}
