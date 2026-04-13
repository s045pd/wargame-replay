/**
 * MobileHeader — compact 44px top bar for mobile.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │  ← Back  │  MILSIM REPLAY  │  ⚙  ⋮      │
 *   └──────────────────────────────────────────┘
 *
 * The overflow menu (⋮) contains: map style, language, bookmarks, auto-director toggle.
 */

import { useState, useRef, useEffect } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useI18n } from '../lib/i18n';
import { ALL_STYLE_KEYS, MapStyleKey } from '../map/styles';

interface MobileHeaderProps {
  onShowSettings: () => void;
  onToggleBookmarks?: () => void;
}

export function MobileHeader({ onShowSettings, onToggleBookmarks }: MobileHeaderProps) {
  const { meta, coordMode, mapStyle, setMapStyle, resetGame } = usePlayback();
  const { autoMode, toggleAutoMode } = useDirector();
  const { locale, setLocale, t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isGeoMode = coordMode === 'wgs84';

  // Close menu on outside tap
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

  return (
    <div
      className="h-11 bg-zinc-900 border-b border-zinc-800 flex items-center px-2 gap-1 shrink-0"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Back */}
      <button
        onClick={resetGame}
        className="w-9 h-9 flex items-center justify-center text-zinc-400 active:text-zinc-100"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Title — centered with flex-1 */}
      <div className="flex-1 min-w-0 text-center">
        <div className="text-xs font-bold text-zinc-100 tracking-wider truncate">
          {t('app_title')}
        </div>
        {meta && (
          <div className="text-[10px] text-zinc-500 truncate">
            {meta.players.length} {t('players')} · {coordMode}
          </div>
        )}
      </div>

      {/* Settings */}
      <button
        onClick={onShowSettings}
        className="w-9 h-9 flex items-center justify-center text-zinc-400 active:text-zinc-100"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {/* Overflow menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="w-9 h-9 flex items-center justify-center text-zinc-400 active:text-zinc-100"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 w-52 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden">

            {/* Auto director */}
            <button
              onClick={() => { toggleAutoMode(); setMenuOpen(false); }}
              className="w-full px-4 py-2.5 text-left text-sm flex items-center gap-2 active:bg-zinc-700"
            >
              <span className={`w-2 h-2 rounded-full ${autoMode ? 'bg-amber-500' : 'bg-zinc-600'}`} />
              <span className="text-zinc-200">{t('auto_director')}</span>
              <span className="ml-auto text-xs text-zinc-500">{autoMode ? 'ON' : 'OFF'}</span>
            </button>

            {/* Bookmarks */}
            {onToggleBookmarks && (
              <button
                onClick={() => { onToggleBookmarks(); setMenuOpen(false); }}
                className="w-full px-4 py-2.5 text-left text-sm text-zinc-200 active:bg-zinc-700"
              >
                {t('bookmarks')}
              </button>
            )}

            {/* Divider */}
            <div className="h-px bg-zinc-700 my-1" />

            {/* Map style (geo only) */}
            {isGeoMode && (
              <div className="px-4 py-2">
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">{t('map_source')}</div>
                <select
                  value={mapStyle}
                  onChange={(e) => { setMapStyle(e.target.value as MapStyleKey); setMenuOpen(false); }}
                  className="w-full bg-zinc-900 text-sm text-zinc-200 border border-zinc-700 rounded px-2 py-1.5 focus:outline-none"
                >
                  {ALL_STYLE_KEYS.map(key => (
                    <option key={key} value={key}>{t(`style_${key}`)}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Language */}
            <div className="px-4 py-2 flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{t('settings_language')}</span>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => setLocale('en')}
                  className={`px-2 py-1 text-xs rounded ${
                    locale === 'en' ? 'bg-zinc-600 text-white' : 'text-zinc-500'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => setLocale('zh')}
                  className={`px-2 py-1 text-xs rounded ${
                    locale === 'zh' ? 'bg-zinc-600 text-white' : 'text-zinc-500'
                  }`}
                >
                  CN
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
