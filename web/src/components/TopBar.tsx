import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useI18n } from '../lib/i18n';
import { MapStyleKey } from '../map/styles';
import { PlayerSearch } from '../map/PlayerSearch';

interface TopBarProps {
  onShowShortcuts?: () => void;
}

export function TopBar({ onShowShortcuts }: TopBarProps) {
  const { meta, coordMode, mapStyle, setMapStyle, trailEnabled, setTrailEnabled, resetGame, setSelectedUnitId, setFollowSelectedUnit } = usePlayback();
  const { mode, setMode } = useDirector();
  const { locale, setLocale, t } = useI18n();

  const isGeoMode = coordMode === 'wgs84';

  const MAP_STYLE_KEYS: MapStyleKey[] = ['dark', 'satellite', 'terrain'];

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
            }}
          />
        </>
      )}
      <div className="flex-1" />

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

      {/* Map style switcher — only for wgs84 geo mode */}
      {isGeoMode && (
        <>
          <div className="flex items-center gap-1">
            {MAP_STYLE_KEYS.map(key => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  mapStyle === key
                    ? 'bg-emerald-700 text-white'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                {t(key)}
              </button>
            ))}
          </div>
          <div className="h-4 w-px bg-zinc-700" />
          {/* Trail toggle */}
          <button
            onClick={() => setTrailEnabled(!trailEnabled)}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              trailEnabled
                ? 'bg-purple-700 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
            }`}
          >
            {t('trails')}
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
