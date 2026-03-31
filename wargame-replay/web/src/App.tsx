import { useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { GameList } from './components/GameList';
import { ShortcutHelp } from './components/ShortcutHelp';
import { usePlayback } from './store/playback';
import { useDirector } from './store/director';
import { useClips } from './store/clips';
import { MapView } from './map/MapView';
import { RelativeCanvas } from './map/RelativeCanvas';
import { Timeline } from './timeline/Timeline';
import { DirectorPanel } from './director/DirectorPanel';
import { BookmarkList } from './clips/BookmarkList';
import { ClipEditor } from './clips/ClipEditor';
import { useHotspotDirector } from './hooks/useHotspotDirector';
import { useHotspotFilter } from './store/hotspotFilter';
import { useI18n } from './lib/i18n';

export default function App() {
  const { gameId, connectWs, connected, play, pause, playing, units, coordMode, currentTs } = usePlayback();
  const { mode, setMode, autoMode, toggleAutoMode } = useDirector();
  const { toggleDebugOverlay } = useHotspotFilter();
  const { addBookmark } = useClips();
  const { t } = useI18n();
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showClipEditor, setShowClipEditor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Hotspot-driven director auto-camera (works in both modes)
  useHotspotDirector();

  useEffect(() => {
    if (gameId) {
      connectWs();
    }
  }, [gameId, connectWs]);

  // Auto-play at default speed once connected (first time only)
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (connected && !autoPlayedRef.current) {
      autoPlayedRef.current = true;
      play();
    }
  }, [connected, play]);

  // Tab key toggles between Replay and Director mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Tab') {
        e.preventDefault();
        setMode(mode === 'replay' ? 'director' : 'replay');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setMode]);

  // B key — toggle bookmark panel; Shift+B adds a bookmark at current timestamp
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'b' || e.key === 'B') {
        if (e.shiftKey) {
          // Shift+B: add bookmark at current timestamp
          if (!gameId || !currentTs) return;
          const ts = currentTs;
          const hh = ts.slice(11, 13);
          const mm = ts.slice(14, 16);
          const ss = ts.slice(17, 19);
          const title = `Bookmark at ${hh}:${mm}:${ss}`;
          void addBookmark(gameId, { ts, title, tags: [] });
        } else {
          // B: toggle the bookmark panel
          setShowBookmarks((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameId, currentTs, addBookmark]);

  // C key — toggle clip editor panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'c' || e.key === 'C') {
        setShowClipEditor((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A key — toggle auto-director
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'a' || e.key === 'A') {
        toggleAutoMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAutoMode]);

  // D key — toggle hotspot debug overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'd' || e.key === 'D') {
        toggleDebugOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDebugOverlay]);

  // Space key — play / pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ' ') {
        e.preventDefault();
        if (playing) pause(); else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, play, pause]);

  // ? key — toggle shortcuts help; Esc closes it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?') {
        setShowShortcuts((prev) => !prev);
      }
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShortcuts]);

  if (!gameId) {
    return <GameList />;
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <TopBar onShowShortcuts={() => setShowShortcuts(true)} />
      {mode === 'director' ? (
        <DirectorPanel />
      ) : (
        <div className="flex-1 relative">
          {coordMode === 'wgs84' ? (
            <MapView units={units} />
          ) : (
            <RelativeCanvas units={units} />
          )}
          {/* Auto-director toggle in replay mode */}
          <button
            onClick={toggleAutoMode}
            className={`absolute bottom-4 left-4 z-10 px-3 py-1.5 rounded text-xs font-medium transition-all backdrop-blur-sm ${
              autoMode
                ? 'bg-amber-600/90 text-white shadow-lg shadow-amber-600/30 border border-amber-500'
                : 'bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500'
            }`}
            title="Auto-track hotspot events (A key)"
          >
            {autoMode ? `⚡ ${t('auto_director_on')}` : `⚡ ${t('auto_director_btn')}`}
          </button>
        </div>
      )}
      <Timeline />
      {showBookmarks && (
        <BookmarkList onClose={() => setShowBookmarks(false)} />
      )}
      {showClipEditor && (
        <ClipEditor onClose={() => setShowClipEditor(false)} />
      )}
      {showShortcuts && (
        <ShortcutHelp onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}
