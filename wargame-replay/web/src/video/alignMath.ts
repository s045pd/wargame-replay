import type { VideoSegment } from '../lib/api';

/**
 * Parse a game timestamp of the form "YYYY-MM-DD HH:MM:SS" as local time
 * and return Unix milliseconds. Returns NaN if the input is malformed.
 *
 * The wargame server emits timestamps in local time with no TZ suffix
 * (see server/scanner/scanner.go:50-58 and server/index/timeindex.go:15-20).
 * JavaScript's Date() constructor interprets (y, m-1, d, h, mi, s) as local
 * time, so the conversion is timezone-symmetric: whatever local zone the
 * user's machine is in is what the game's clock was recorded in.
 */
export function parseGameTs(ts: string): number {
  if (!ts) return NaN;
  const parts = ts.split(' ');
  if (parts.length !== 2) return NaN;
  const [datePart, timePart] = parts;
  const dateFields = datePart.split('-').map(Number);
  const timeFields = timePart.split(':').map(Number);
  if (dateFields.length !== 3 || timeFields.length !== 3) return NaN;
  if (dateFields.some(Number.isNaN) || timeFields.some(Number.isNaN)) return NaN;
  const [y, mo, da] = dateFields;
  const [h, mi, s] = timeFields;
  return new Date(y, mo - 1, da, h, mi, s).getTime();
}

/** Return the Unix milliseconds of a segment's StartTs (ISO string). */
export function segmentStartMs(seg: VideoSegment): number {
  return Date.parse(seg.startTs);
}

/** Locate the segment that contains videoMs. Returns null on miss. */
export function findSegment(
  segments: VideoSegment[],
  videoMs: number,
): { segment: VideoSegment; index: number; segStartMs: number } | null {
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i];
    const start = segmentStartMs(s);
    const end = start + s.durationMs;
    if (videoMs >= start && videoMs < end) {
      return { segment: s, index: i, segStartMs: start };
    }
  }
  return null;
}

/** Clamp a number to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Convenience: compute offsetMs from a reference pair (game, video). */
export function calcOffsetMs(gameMs: number, videoMs: number): number {
  return gameMs - videoMs;
}

/**
 * Format an ms duration as "MM:SS" or "H:MM:SS". Used in UI badges.
 */
export function formatDurationMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/**
 * Format an offsetMs as a human-readable "video is N earlier/later".
 * offsetMs > 0 → video is earlier than game by offsetMs.
 * offsetMs < 0 → video is later than game by |offsetMs|.
 */
export function formatOffsetMs(offsetMs: number): string {
  const abs = Math.abs(offsetMs);
  const seconds = (abs / 1000).toFixed(abs < 1000 ? 2 : 1);
  if (offsetMs === 0) return '0s';
  return offsetMs > 0 ? `+${seconds}s` : `-${seconds}s`;
}
