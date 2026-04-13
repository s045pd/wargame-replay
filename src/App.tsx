import { useEffect, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import { MobileHeader } from './components/MobileHeader';
import { GameBrowser } from './components/GameBrowser';
import { ShortcutHelp } from './components/ShortcutHelp';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { usePlayback } from './store/playback';
import { useDirector } from './store/director';
import { useVisualConfig } from './store/visualConfig';
import { useClips } from './store/clips';
import { MapView } from './map/MapView';
import { RelativeCanvas } from './map/RelativeCanvas';
import { Timeline } from './timeline/Timeline';
import { MobileBottomBar } from './timeline/MobileBottomBar';
import { DirectorPanel } from './director/DirectorPanel';
import { BookmarkList } from './clips/BookmarkList';
import { ClipEditor } from './clips/ClipEditor';
import { useHotspotDirector } from './hooks/useHotspotDirector';
import { useHotspotFilter } from './store/hotspotFilter';
import { useIsMobile } from './hooks/useIsMobile';


export default function App() {
  const { gameId, connected, play, pause, playing, units, coordMode, currentTs, toggleTiltMode } = usePlayback();
  const { mode, setMode, toggleAutoMode, immersive, toggleImmersive } = useDirector();
  const { toggleDebugOverlay } = useHotspotFilter();
  const { addBookmark } = useClips();
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showClipEditor, setShowClipEditor] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const isMobile = useIsMobile();

  // Hotspot-driven director auto-camera (works in both modes)
  useHotspotDirector();

  // Auto-play at default speed once connected (first time only).
  const autoPlayedRef = useRef(false);
  useEffect(() => {
    if (connected && !autoPlayedRef.current) {
      autoPlayedRef.current = true;
      const vc = useVisualConfig.getState();
      if (!vc.autoPlay) return;

      if (vc.introAnimation) {
        const delayMs = vc.introDuration * 1000 + 300;
        const timer = setTimeout(() => play(), delayMs);
        return () => clearTimeout(timer);
      }
      play();
    }
  }, [connected, play]);

  // ── Keyboard shortcuts (desktop only) ──
  // Tab key toggles between Replay and Director mode
  useEffect(() => {
    if (isMobile) return;
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
  }, [mode, setMode, isMobile]);

  // B key — toggle bookmark panel; Shift+B adds a bookmark at current timestamp
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'b' || e.key === 'B') {
        if (e.shiftKey) {
          if (!gameId || !currentTs) return;
          const ts = currentTs;
          const hh = ts.slice(11, 13);
          const mm = ts.slice(14, 16);
          const ss = ts.slice(17, 19);
          const title = `Bookmark at ${hh}:${mm}:${ss}`;
          void addBookmark(gameId, { ts, title, tags: [] });
        } else {
          setShowBookmarks((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameId, currentTs, addBookmark, isMobile]);

  // C key — toggle clip editor panel
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'c' || e.key === 'C') {
        setShowClipEditor((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isMobile]);

  // A key — toggle auto-director
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'a' || e.key === 'A') {
        toggleAutoMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAutoMode, isMobile]);

  // D key — toggle hotspot debug overlay
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'd' || e.key === 'D') {
        toggleDebugOverlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleDebugOverlay, isMobile]);

  // Space key — play / pause
  useEffect(() => {
    if (isMobile) return;
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
  }, [playing, play, pause, isMobile]);

  // H key — toggle immersive mode
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'h' || e.key === 'H') {
        toggleImmersive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleImmersive, isMobile]);

  // T key — toggle 3D tilt mode
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 't' || e.key === 'T') {
        toggleTiltMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTiltMode, isMobile]);

  // ? key — toggle shortcuts help; Esc closes it
  useEffect(() => {
    if (isMobile) return;
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
  }, [showShortcuts, isMobile]);

  // , key — toggle settings panel; Esc closes it
  useEffect(() => {
    if (isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === ',') {
        setShowSettings((prev) => !prev);
      }
      if (e.key === 'Escape' && showSettings) {
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSettings, isMobile]);

  if (!gameId) {
    return <GameBrowser isMobile={isMobile} />;
  }

  // On mobile: always replay mode, no director panel
  const effectiveMode = isMobile ? 'replay' : mode;
  const showMap = immersive || effectiveMode === 'replay';

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      {!immersive && (
        isMobile ? (
          <MobileHeader
            onShowSettings={() => setShowSettings(true)}
            onToggleBookmarks={() => setShowBookmarks(prev => !prev)}
          />
        ) : (
          <TopBar onShowShortcuts={() => setShowShortcuts(true)} onShowSettings={() => setShowSettings(true)} />
        )
      )}

      {/* Main content */}
      {!immersive && effectiveMode === 'director' ? (
        <DirectorPanel />
      ) : (
        <div className="flex-1 relative">
          {showMap && (
            coordMode === 'wgs84' ? (
              <MapView units={units} immersive={immersive} isMobile={isMobile} />
            ) : (
              <RelativeCanvas units={units} />
            )
          )}
        </div>
      )}

      {/* Bottom bar */}
      {!immersive && (
        isMobile ? (
          <MobileBottomBar />
        ) : (
          <Timeline />
        )
      )}

      {/* Panels */}
      {!immersive && showBookmarks && (
        <BookmarkList onClose={() => setShowBookmarks(false)} />
      )}
      {!immersive && !isMobile && showClipEditor && (
        <ClipEditor onClose={() => setShowClipEditor(false)} />
      )}
      {!isMobile && showShortcuts && (
        <ShortcutHelp onClose={() => setShowShortcuts(false)} />
      )}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
