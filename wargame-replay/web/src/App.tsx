import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { GameList } from './components/GameList';
import { usePlayback } from './store/playback';
import { useDirector } from './store/director';
import { useClips } from './store/clips';
import { MapView } from './map/MapView';
import { RelativeCanvas } from './map/RelativeCanvas';
import { Timeline } from './timeline/Timeline';
import { DirectorPanel } from './director/DirectorPanel';
import { BookmarkList } from './clips/BookmarkList';
import { ClipEditor } from './clips/ClipEditor';

export default function App() {
  const { gameId, connectWs, units, coordMode, currentTs } = usePlayback();
  const { mode, setMode } = useDirector();
  const { addBookmark } = useClips();
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showClipEditor, setShowClipEditor] = useState(false);

  useEffect(() => {
    if (gameId) {
      connectWs();
    }
  }, [gameId, connectWs]);

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

  if (!gameId) {
    return <GameList />;
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <TopBar />
      {mode === 'director' ? (
        <DirectorPanel />
      ) : (
        <div className="flex-1 relative">
          {coordMode === 'wgs84' ? (
            <MapView units={units} />
          ) : (
            <RelativeCanvas units={units} />
          )}
        </div>
      )}
      <Timeline />
      {showBookmarks && (
        <BookmarkList onClose={() => setShowBookmarks(false)} />
      )}
      {showClipEditor && (
        <ClipEditor onClose={() => setShowClipEditor(false)} />
      )}
    </div>
  );
}
