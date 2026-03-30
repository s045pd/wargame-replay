import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { MapStyleKey } from '../map/styles';

const MAP_STYLE_LABELS: Record<MapStyleKey, string> = {
  dark: 'Dark',
  satellite: 'Satellite',
  terrain: 'Terrain',
};

export function TopBar() {
  const { meta, coordMode, mapStyle, setMapStyle, trailEnabled, setTrailEnabled, resetGame } = usePlayback();
  const { mode, setMode } = useDirector();

  const isGeoMode = coordMode === 'wgs84';

  return (
    <div className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-4">
      <button
        onClick={resetGame}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
        title="Back to game list"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Games
      </button>
      <div className="h-4 w-px bg-zinc-700" />
      <div className="text-sm font-bold text-zinc-100 tracking-wider">
        WARGAME REPLAY
      </div>
      <div className="h-4 w-px bg-zinc-700" />
      {meta && (
        <div className="text-xs text-zinc-400">
          {meta.players.length} players · {coordMode}
        </div>
      )}
      <div className="flex-1" />

      {/* Map style switcher — only for wgs84 geo mode */}
      {isGeoMode && (
        <>
          <div className="flex items-center gap-1">
            {(Object.keys(MAP_STYLE_LABELS) as MapStyleKey[]).map(key => (
              <button
                key={key}
                onClick={() => setMapStyle(key)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  mapStyle === key
                    ? 'bg-emerald-700 text-white'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
                title={`Switch to ${MAP_STYLE_LABELS[key]} map style`}
              >
                {MAP_STYLE_LABELS[key]}
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
            title="Toggle unit trails"
          >
            Trails
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
          title="Replay mode (Tab)"
        >
          Replay
        </button>
        <button
          onClick={() => setMode('director')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'director'
              ? 'bg-amber-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Director mode (Tab)"
        >
          Director
        </button>
      </div>
    </div>
  );
}
