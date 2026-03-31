import { useRef, useCallback } from 'react';
import { usePlayback } from '../store/playback';

interface PlayheadProps {
  /** Left offset of the track area (label sidebar width in px) */
  trackAreaLeft: number;
}

/**
 * Vertical playhead line that sits on top of the track area.
 * Draggable: converts mouse X position to a seek timestamp.
 */
export function Playhead({ trackAreaLeft }: PlayheadProps) {
  const { currentTs, meta, seek } = usePlayback();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const parseTs = (ts: string) => new Date(ts.replace(' ', 'T')).getTime();
  const toDbTs = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const positionPercent = useCallback((): number => {
    if (!meta || !currentTs) return 0;
    const start = parseTs(meta.startTime);
    const end = parseTs(meta.endTime);
    const cur = parseTs(currentTs);
    const total = end - start;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, (cur - start) / total));
  }, [meta, currentTs]);

  const seekFromX = useCallback(
    (clientX: number) => {
      if (!meta || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const trackWidth = rect.width - trackAreaLeft;
      const x = clientX - rect.left - trackAreaLeft;
      const ratio = Math.max(0, Math.min(1, x / trackWidth));
      const start = parseTs(meta.startTime);
      const end = parseTs(meta.endTime);
      const ts = toDbTs(start + ratio * (end - start));
      seek(ts);
    },
    [meta, seek, trackAreaLeft],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    seekFromX(e.clientX);

    const onMove = (ev: MouseEvent) => {
      if (dragging.current) seekFromX(ev.clientX);
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const pct = positionPercent();
  // Position relative to the full container width.
  // The track area starts at `trackAreaLeft` px, so the playhead left offset is:
  //   trackAreaLeft + pct * (totalWidth - trackAreaLeft)
  // Expressed in CSS: calc(trackAreaLeft + pct * (100% - trackAreaLeft))
  const lineStyle: React.CSSProperties = {
    left: `calc(${trackAreaLeft}px + ${pct * 100}% - ${pct * trackAreaLeft}px)`,
    zIndex: 10,
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ cursor: 'col-resize' }}
      onMouseDown={handleMouseDown}
    >
      {/* Playhead line */}
      <div
        className="absolute top-0 bottom-0 w-px bg-yellow-400 pointer-events-none"
        style={lineStyle}
      >
        {/* Triangle handle at top */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0"
          style={{
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '6px solid #facc15',
          }}
        />
      </div>
    </div>
  );
}
