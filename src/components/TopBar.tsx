import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useI18n } from '../lib/i18n';
import { ALL_STYLE_KEYS, MapStyleKey } from '../map/styles';
import { PlayerSearch } from '../map/PlayerSearch';

interface TopBarProps {
  onShowShortcuts?: () => void;
  onShowSettings?: () => void;
}

export function TopBar({ onShowShortcuts, onShowSettings }: TopBarProps) {
  const { meta, coordMode, mapStyle, setMapStyle, tiltMode, toggleTiltMode, resetGame, setSelectedUnitId, setFollowSelectedUnit, setManualFollow } = usePlayback();
  const { mode, setMode } = useDirector();
  const { locale, setLocale, t } = useI18n();

  const isGeoMode = coordMode === 'wgs84';

  return (
    <div className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-4">
      <button
        onClick={resetGame}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
        title={t('games')}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {t('games')}
      </button>
      <div className="h-4 w-px bg-zinc-700" />
      <div className="text-sm font-bold text-zinc-100 tracking-wider">
        {t('app_title')}
      </div>
      <div className="h-4 w-px bg-zinc-700" />
      {meta && (
        <div className="text-xs text-zinc-400">
          {meta.players.length} {t('players')} · {coordMode}
        </div>
      )}
      {meta && meta.players.length > 0 && (
        <>
          <div className="h-4 w-px bg-zinc-700" />
          <PlayerSearch
            players={meta.players}
            onSelect={(id) => {
              setSelectedUnitId(id);
              setFollowSelectedUnit(true);
              setManualFollow(true);
            }}
          />
        </>
      )}
      <div className="flex-1" />

      {/* Settings button */}
      {onShowSettings && (
        <button
          onClick={onShowSettings}
          className="w-6 h-6 flex items-center justify-center rounded text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          title={`${t('settings')} (,)`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

      {/* Shortcuts help button */}
      {onShowShortcuts && (
        <button
          onClick={onShowShortcuts}
          className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          title={`${t('shortcut_help')} (?)`}
        >
          ?
        </button>
      )}

      {/* Language toggle */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setLocale('en')}
          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
            locale === 'en'
              ? 'bg-zinc-600 text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          EN
        </button>
        <button
          onClick={() => setLocale('zh')}
          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
            locale === 'zh'
              ? 'bg-zinc-600 text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          CN
        </button>
      </div>
      <div className="h-4 w-px bg-zinc-700" />

      {/* Map style dropdown + tilt toggle — only for wgs84 geo mode */}
      {isGeoMode && (
        <>
          <select
            value={mapStyle}
            onChange={(e) => setMapStyle(e.target.value as MapStyleKey)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 cursor-pointer hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-600"
            title={t('map_source')}
          >
            {ALL_STYLE_KEYS.map(key => (
              <option key={key} value={key}>{t(`style_${key}`)}</option>
            ))}
          </select>
          <button
            onClick={toggleTiltMode}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              tiltMode
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
            title={`${t('tilt_mode')} (T)`}
          >
            {t('tilt_mode')}
          </button>
          <div className="h-4 w-px bg-zinc-700" />
        </>
      )}

      <div className="flex items-center gap-1">
        <button
          onClick={() => setMode('replay')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'replay'
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Tab"
        >
          {t('replay')}
        </button>
        <button
          onClick={() => setMode('director')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'director'
              ? 'bg-amber-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Tab"
        >
          {t('director')}
        </button>
      </div>
    </div>
  );
}
