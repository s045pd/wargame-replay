import { useState, useCallback } from 'react';
import { getMapboxToken, setMapboxToken, resetMapboxToken, isEnvToken, hasMapboxToken } from '../map/styles';
import { usePlayback } from '../store/playback';
import { useI18n } from '../lib/i18n';

interface SettingsProps {
  onClose: () => void;
}

export function Settings({ onClose }: SettingsProps) {
  const { t } = useI18n();
  const bumpStyleNonce = usePlayback((s) => s.bumpStyleNonce);
  const [token, setToken] = useState(getMapboxToken());
  const [saved, setSaved] = useState(false);
  const [fromEnv, setFromEnv] = useState(isEnvToken());
  const [usingMapbox, setUsingMapbox] = useState(hasMapboxToken());
  // Track whether a localStorage override exists (Reset removes it)
  const [hasOverride, setHasOverride] = useState(() => {
    try { return localStorage.getItem('mapbox-token') !== null; } catch { return false; }
  });

  const flash = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const handleSave = useCallback(() => {
    setMapboxToken(token.trim());
    setFromEnv(false);
    setHasOverride(true);
    setUsingMapbox(token.trim().length > 0);
    bumpStyleNonce(); // force map to reload with new token
    flash();
  }, [token, bumpStyleNonce, flash]);

  const handleClear = useCallback(() => {
    setToken('');
    setMapboxToken(''); // explicitly store empty → free tiles
    setFromEnv(false);
    setHasOverride(true);
    setUsingMapbox(false);
    bumpStyleNonce();
    flash();
  }, [bumpStyleNonce, flash]);

  const handleReset = useCallback(() => {
    resetMapboxToken(); // remove localStorage override, fall back to env var
    const effective = getMapboxToken();
    setToken(effective);
    setFromEnv(isEnvToken());
    setHasOverride(false);
    setUsingMapbox(effective.length > 0);
    bumpStyleNonce();
    flash();
  }, [bumpStyleNonce, flash]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-100">{t('settings')}</h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200 transition-colors text-xl leading-none"
            title={t('close')}
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Current tile provider indicator */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
            <span className={`w-2 h-2 rounded-full ${usingMapbox ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-xs text-zinc-300">
              {t('tile_provider')}:
            </span>
            <span className={`text-xs font-medium ${usingMapbox ? 'text-emerald-400' : 'text-amber-400'}`}>
              {usingMapbox ? 'Mapbox' : t('free_tiles')}
            </span>
            {!usingMapbox && (
              <span className="text-[10px] text-zinc-500 ml-auto">CARTO / ESRI</span>
            )}
          </div>

          {/* Mapbox Token Section */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1.5">
              {t('mapbox_token')}
            </label>
            <p className="text-xs text-zinc-500 mb-2">
              {t('mapbox_token_hint')}
            </p>
            <input
              type="text"
              value={token}
              onChange={(e) => { setToken(e.target.value); setSaved(false); }}
              placeholder="pk.eyJ1Ijoi..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              spellCheck={false}
            />
            {fromEnv && (
              <p className="text-[10px] text-amber-500 mt-1">
                {t('mapbox_token_from_env')}
              </p>
            )}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={handleSave}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
              >
                {t('save')}
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
              >
                {t('clear')}
              </button>
              {hasOverride && (
                <button
                  onClick={handleReset}
                  className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
                  title={t('mapbox_token_reset_hint')}
                >
                  {t('reset')}
                </button>
              )}
              {saved && (
                <span className="text-xs text-emerald-400 animate-pulse">
                  {t('saved')}
                </span>
              )}
            </div>
            <p className="text-[10px] text-zinc-600 mt-2">
              {t('mapbox_token_note')}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded-lg transition-colors"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}
