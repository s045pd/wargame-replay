// Single-clip video recording helper. Used by ExportDialog (single) and
// ClipEditor (bulk export).

import { usePlayback } from '../store/playback';
import type { Clip } from '../store/clips';

function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return 'video/webm';
}

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface RecordOptions {
  /** Game-time speed multiplier during recording (e.g. 8 = 8× faster than real time). */
  speed: number;
  /** Bits per second for the encoder. Default 8 Mbps. */
  videoBitsPerSecond?: number;
  /** Aborted? Bulk export uses this to bail mid-record. */
  abortSignal?: { aborted: boolean };
  /** Unit to follow during recording. If null, recording is skipped (returns null).
   *  Required to prevent the auto-director from fitting a hotspot circle that
   *  would zoom the camera out beyond the unit's actual action. */
  followUnitId: number | null;
}

/** Record a single clip as a webm Blob. Resolves to null if aborted, no canvas
 *  is found, or `opts.followUnitId` is null. */
export async function recordClip(clip: Clip, opts: RecordOptions): Promise<Blob | null> {
  if (opts.followUnitId == null) return null;

  const mapCanvas = (document.querySelector('.mapboxgl-canvas') || document.querySelector('canvas')) as HTMLCanvasElement | null;
  if (!mapCanvas) return null;

  const pb = usePlayback.getState();
  const { seek, play, pause } = pb;

  // Save state we'll restore after recording so we don't leak the lock.
  const prevSelectedUnitId = pb.selectedUnitId;
  const prevFollow = pb.followSelectedUnit;
  const prevManualFollow = pb.manualFollow;

  // Lock the camera onto our unit and tell the director to stand down.
  // (useHotspotDirector checks both isRecording and manualFollow.)
  pb.setIsRecording(true);
  pb.setSelectedUnitId(opts.followUnitId);
  pb.setFollowSelectedUnit(true);
  pb.setManualFollow(true);

  const cleanup = () => {
    const cur = usePlayback.getState();
    cur.setIsRecording(false);
    cur.setManualFollow(prevManualFollow);
    cur.setFollowSelectedUnit(prevFollow);
    // Only restore selectedUnitId if it was different — avoid clobbering the
    // user's selection between bulk clips. In practice bulk export keeps the
    // same unit across all clips so prevSelectedUnitId === opts.followUnitId.
    if (prevSelectedUnitId !== opts.followUnitId) {
      cur.setSelectedUnitId(prevSelectedUnitId);
    }
  };

  try {
    pause();
    seek(clip.startTs);
    // Let the seek render before we open the MediaRecorder.
    await sleep(800);
    if (opts.abortSignal?.aborted) { cleanup(); return null; }

    const stream = mapCanvas.captureStream(30);
    const recorder = new MediaRecorder(stream, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: opts.videoBitsPerSecond ?? 8_000_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    const recorded = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });

    const endMs = parseTs(clip.endTs);
    // Stop the recorder when playback time passes the clip's end timestamp.
    const unsub = usePlayback.subscribe((state) => {
      if (!state.currentTs) return;
      if (parseTs(state.currentTs) >= endMs && recorder.state === 'recording') {
        recorder.stop();
      }
    });

    recorder.start(200);
    play(opts.speed);

    // Safety net: hard timeout at 2× the expected real duration in case the
    // playback subscription never fires (paused mid-record, etc).
    const expectedRealMs = ((endMs - parseTs(clip.startTs)) / opts.speed) + 1000;
    const timeoutHandle = window.setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, Math.max(expectedRealMs * 2, 5000));

    // Cooperative abort: poll the signal and stop the recorder if it fires.
    const abortHandle = window.setInterval(() => {
      if (opts.abortSignal?.aborted && recorder.state === 'recording') {
        recorder.stop();
      }
    }, 200);

    const blob = await recorded;
    clearTimeout(timeoutHandle);
    clearInterval(abortHandle);
    unsub();
    pause();
    return blob;
  } finally {
    cleanup();
  }
}
