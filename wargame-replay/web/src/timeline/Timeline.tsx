import { useCallback } from 'react';
import { TransportControls } from './TransportControls';
import { Track, TrackRenderContext } from './Track';
import { HotspotTrack } from './HotspotTrack';
import { Playhead } from './Playhead';
import { useI18n } from '../lib/i18n';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useClips } from '../store/clips';

/** Width of the label sidebar in the track area (must match Track's w-24 = 96px) */
const LABEL_WIDTH = 96;

/** Hotspot track height */
const HOTSPOT_HEIGHT = 24;

/** Track definitions with heights */
const TRACK_HEIGHT = 20;

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

function toDbTs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Timeline container.
 *
 * - Normal mode: TransportControls + Hotspot track (canvas) + Camera/Bookmarks/Clips tracks + Playhead.
 * - Immersive mode (~40px): TransportControls only (tracks hidden).
 * - H key toggles between modes.
 */
export function Timeline() {
  const { t } = useI18n();
  const { meta, currentTs, seek } = usePlayback();
  const { cameraHistory } = useDirector();
  const { bookmarks, clips } = useClips();

  const startMs = meta ? parseTs(meta.startTime) : 0;
  const endMs = meta ? parseTs(meta.endTime) : 0;
  const totalMs = endMs - startMs;

  // --- Camera track renderer ---
  const renderCamera = useCallback(
    ({ ctx, width: w, height: h }: TrackRenderContext) => {
      if (totalMs <= 0) return;
      const curMs = currentTs ? parseTs(currentTs) : startMs;

      for (const ev of cameraHistory) {
        if (!ev.gameTs) continue;
        const evMs = parseTs(ev.gameTs);
        const x = ((evMs - startMs) / totalMs) * w;
        if (x < 0 || x > w) continue;

        const isPast = curMs > evMs;
        // Auto switches are amber, manual are blue
        ctx.fillStyle = ev.auto ? '#f59e0b' : '#60a5fa';
        ctx.globalAlpha = isPast ? 0.35 : 0.85;

        // Draw a tick mark
        ctx.fillRect(x - 0.5, 2, 1.5, h - 4);

        // Small diamond on top for emphasis
        ctx.beginPath();
        ctx.moveTo(x, 1);
        ctx.lineTo(x + 3, h / 2);
        ctx.lineTo(x, h - 1);
        ctx.lineTo(x - 3, h / 2);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = 1;
      }
    },
    [cameraHistory, currentTs, startMs, totalMs],
  );

  // --- Bookmarks track renderer ---
  const renderBookmarks = useCallback(
    ({ ctx, width: w, height: h }: TrackRenderContext) => {
      if (totalMs <= 0) return;
      const curMs = currentTs ? parseTs(currentTs) : startMs;

      for (const bm of bookmarks) {
        if (!bm.ts) continue;
        const bmMs = parseTs(bm.ts);
        const x = ((bmMs - startMs) / totalMs) * w;
        if (x < 0 || x > w) continue;

        const isPast = curMs > bmMs;
        ctx.fillStyle = '#22c55e';
        ctx.globalAlpha = isPast ? 0.35 : 0.85;

        // Vertical tick
        ctx.fillRect(x - 0.5, 1, 1.5, h - 2);

        // Small triangle at top
        ctx.beginPath();
        ctx.moveTo(x - 4, 0);
        ctx.lineTo(x + 4, 0);
        ctx.lineTo(x, 5);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = 1;
      }
    },
    [bookmarks, currentTs, startMs, totalMs],
  );

  // --- Clips track renderer ---
  const renderClips = useCallback(
    ({ ctx, width: w, height: h }: TrackRenderContext) => {
      if (totalMs <= 0) return;
      const curMs = currentTs ? parseTs(currentTs) : startMs;

      for (const clip of clips) {
        if (!clip.startTs || !clip.endTs) continue;
        const clipStart = parseTs(clip.startTs);
        const clipEnd = parseTs(clip.endTs);
        const x1 = ((clipStart - startMs) / totalMs) * w;
        const x2 = ((clipEnd - startMs) / totalMs) * w;
        const barW = Math.max(3, x2 - x1);

        const isActive = curMs >= clipStart && curMs <= clipEnd;
        ctx.fillStyle = '#a855f7';
        ctx.globalAlpha = isActive ? 0.7 : 0.3;

        // Clip range bar
        const barY = 3;
        const barH = h - 6;
        ctx.fillRect(x1, barY, barW, barH);

        // Border for active
        if (isActive) {
          ctx.strokeStyle = '#a855f7';
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
          ctx.strokeRect(x1, barY, barW, barH);
        }

        ctx.globalAlpha = 1;
      }
    },
    [clips, currentTs, startMs, totalMs],
  );

  // --- Click handler: seek to the clicked time position ---
  const handleTrackClick = useCallback(
    (ratio: number) => {
      if (totalMs <= 0) return;
      const ts = toDbTs(startMs + ratio * totalMs);
      seek(ts);
    },
    [startMs, totalMs, seek],
  );

  const totalHeight = HOTSPOT_HEIGHT + TRACK_HEIGHT * 3;

  return (
    <div className="flex flex-col bg-zinc-950 border-t border-zinc-800 shrink-0">
      {/* Transport controls row */}
      <TransportControls />

      {/* Tracks area */}
      <div className="relative" style={{ height: totalHeight }}>
          {/* Hotspot track — custom canvas with event bars */}
          <HotspotTrack height={HOTSPOT_HEIGHT} labelWidth={LABEL_WIDTH} />

          {/* Camera track */}
          <Track
            label={t('camera')}
            height={TRACK_HEIGHT}
            color="#60a5fa"
            onRender={renderCamera}
            onClick={handleTrackClick}
          />

          {/* Bookmarks track */}
          <Track
            label={t('bookmarks')}
            height={TRACK_HEIGHT}
            color="#22c55e"
            onRender={renderBookmarks}
            onClick={handleTrackClick}
          />

          {/* Clips track */}
          <Track
            label={t('clips')}
            height={TRACK_HEIGHT}
            color="#a855f7"
            onRender={renderClips}
            onClick={handleTrackClick}
          />

          {/* Playhead overlaid on top of the tracks */}
          <Playhead trackAreaLeft={LABEL_WIDTH} />
        </div>
    </div>
  );
}
