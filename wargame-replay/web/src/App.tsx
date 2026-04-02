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


export default function App() {
  const { gameId, connectWs, connected, play, pause, playing, units, coordMode, currentTs } = usePlayback();
  const { mode, setMode, toggleAutoMode, immersive, toggleImmersive } = useDirector();
  const { toggleDebugOverlay } = useHotspotFilter();
  const { addBookmark } = useClips();
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

  // H key — toggle immersive mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'h' || e.key === 'H') {
        toggleImmersive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleImmersive]);

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

  // In immersive mode: always show map (replay layout), hide top/bottom chrome
  const showMap = immersive || mode === 'replay';

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {!immersive && <TopBar onShowShortcuts={() => setShowShortcuts(true)} />}
      {!immersive && mode === 'director' ? (
        <DirectorPanel />
      ) : (
        <div className="flex-1 relative">
          {showMap && (
            coordMode === 'wgs84' ? (
              <MapView units={units} immersive={immersive} />
            ) : (
              <RelativeCanvas units={units} />
            )
          )}
        </div>
      )}
      {!immersive && <Timeline />}
      {!immersive && showBookmarks && (
        <BookmarkList onClose={() => setShowBookmarks(false)} />
      )}
      {!immersive && showClipEditor && (
        <ClipEditor onClose={() => setShowClipEditor(false)} />
      )}
      {showShortcuts && (
        <ShortcutHelp onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}
