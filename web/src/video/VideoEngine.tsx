import { useEffect, useRef } from 'react';
import { usePlayback } from '../store/playback';
import { useVideos } from '../store/videos';
import { findSegment, parseGameTs, clamp } from './alignMath';
import { videoStreamUrl, type VideoGroup } from '../lib/api';

/**
 * Registry of HTMLVideoElement DOM nodes managed by FloatingVideoCard.
 * The engine looks up elements here by group id to drive playback.
 */
const videoRegistry = new Map<string, HTMLVideoElement>();

export function registerVideoElement(groupId: string, el: HTMLVideoElement | null): void {
  if (el) {
    videoRegistry.set(groupId, el);
  } else {
    videoRegistry.delete(groupId);
  }
}

/** Placeholder display state per group for the card UI to consume. */
export type VideoCardMode = 'ready' | 'out-of-range' | 'error' | 'incompatible' | 'transcoding';

const cardModes = new Map<string, VideoCardMode>();
const cardModeSubscribers = new Map<string, Set<() => void>>();

export function getCardMode(groupId: string): VideoCardMode {
  return cardModes.get(groupId) ?? 'ready';
}

export function subscribeCardMode(groupId: string, cb: () => void): () => void {
  let set = cardModeSubscribers.get(groupId);
  if (!set) {
    set = new Set();
    cardModeSubscribers.set(groupId, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

function setCardMode(groupId: string, mode: VideoCardMode): void {
  const prev = cardModes.get(groupId);
  if (prev === mode) return;
  cardModes.set(groupId, mode);
  cardModeSubscribers.get(groupId)?.forEach((cb) => cb());
}

/**
 * Drift threshold in seconds above which the engine reseeks the video.
 * 0.2 s matches the game clock's sub-second noise floor without causing
 * the video to thrash on every tick.
 */
const DRIFT_THRESHOLD = 0.2;

/** Soft cap on HTMLVideoElement.playbackRate. Most browsers only allow ≤16. */
const MAX_PLAYBACK_RATE = 16;
const MIN_PLAYBACK_RATE = 0.0625;

interface Hint {
  link: HTMLLinkElement;
  href: string;
}
const preloadHints: Hint[] = [];

function preloadSegment(href: string): void {
  if (preloadHints.some((h) => h.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'video';
  link.href = href;
  document.head.appendChild(link);
  preloadHints.push({ link, href });
  // Keep only the 4 most recent hints to bound memory.
  while (preloadHints.length > 4) {
    const old = preloadHints.shift();
    if (old) old.link.remove();
  }
}

function handleError(groupId: string, segCompatible: boolean): void {
  setCardMode(groupId, segCompatible ? 'error' : 'incompatible');
}

/**
 * Sync one VideoGroup's <video> element to the game clock for the current
 * playback state. Called whenever anything observable changes.
 */
function syncOne(group: VideoGroup, currentTs: string, playing: boolean, speed: number): void {
  const videoEl = videoRegistry.get(group.id);
  if (!videoEl) return;

  const gameMs = parseGameTs(currentTs);
  if (!Number.isFinite(gameMs)) {
    setCardMode(group.id, 'out-of-range');
    return;
  }
  const videoMs = gameMs - group.offsetMs;
  const hit = findSegment(group.segments, videoMs);
  if (!hit) {
    setCardMode(group.id, 'out-of-range');
    if (!videoEl.paused) videoEl.pause();
    return;
  }

  const { segment, index, segStartMs } = hit;
  const needsTranscode = !segment.compatible;
  const targetLocal = (videoMs - segStartMs) / 1000;

  if (needsTranscode) {
    // ── Real-time transcoding path ──
    // ffmpeg streams fragmented MP4 from a seek point. Restarting ffmpeg
    // is expensive (~1-2s cold start), so we only restart on:
    //   1. First load (no src set yet)
    //   2. Segment changed (different file)
    //   3. Catastrophic drift (>60s behind — user probably did a manual seek)
    //
    // For normal playback, ffmpeg runs continuously and the <video> plays
    // at its own pace. Small drift (5-30s) is acceptable — the video is
    // "close enough" to the game clock. This avoids the stop-start
    // stuttering that killed usability at any speed.

    const seekSec = Math.max(0, Math.floor(targetLocal));
    const haveSrc = videoEl.dataset.currentRelPath ?? '';
    const currentSegPath = haveSrc.split('|')[0] || '';
    const isNewSegment = currentSegPath !== segment.relPath;
    const isFirstLoad = haveSrc === '' || !haveSrc.includes('|tc|');

    // Only measure drift when the video has actually loaded some data.
    const currentDrift = videoEl.readyState >= 1
      ? Math.abs(videoEl.currentTime - targetLocal)
      : 0;
    const isCatastrophicDrift = currentDrift > 60;

    const needsNewStream = isFirstLoad || isNewSegment || isCatastrophicDrift;

    if (needsNewStream) {
      videoEl.src = videoStreamUrl(segment.relPath) + `?transcode=1&seek=${seekSec}`;
      videoEl.dataset.currentRelPath = `${segment.relPath}|tc|${seekSec}`;
      setCardMode(group.id, 'transcoding');
    }

    if (playing && videoEl.paused) {
      const p = videoEl.play();
      if (p) p.catch(() => { /* expected during transcode buffering */ });
    } else if (!playing && !videoEl.paused) {
      videoEl.pause();
    }

    // Let the video play at game speed. The transcode stream is real-time
    // output, so playbackRate > 1 means the video will gradually outrun
    // the stream buffer — capped at 2x to avoid starvation.
    videoEl.playbackRate = clamp(speed, MIN_PLAYBACK_RATE, 2);

    if (videoEl.readyState >= 2) {
      setCardMode(group.id, 'ready');
    }
    return;
  }

  // ── Direct streaming path (H.264 / compatible) ──
  const targetSrc = videoStreamUrl(segment.relPath);
  const currentSrc = videoEl.dataset.currentRelPath ?? '';
  if (currentSrc !== segment.relPath) {
    videoEl.src = targetSrc;
    videoEl.dataset.currentRelPath = segment.relPath;
    setCardMode(group.id, 'ready');
    // Preload the next segment so the transition at end-of-file is seamless.
    const next = group.segments[index + 1];
    if (next && next.compatible) preloadSegment(videoStreamUrl(next.relPath));
  }

  const current = videoEl.currentTime;
  if (Number.isFinite(current) && Math.abs(current - targetLocal) > DRIFT_THRESHOLD) {
    try {
      videoEl.currentTime = targetLocal;
    } catch {
      /* seeking may reject during early load */
    }
  }

  if (playing && videoEl.paused) {
    const p = videoEl.play();
    if (p) {
      p.catch(() => {
        handleError(group.id, segment.compatible);
      });
    }
  } else if (!playing && !videoEl.paused) {
    videoEl.pause();
  }

  videoEl.playbackRate = clamp(speed, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE);
  setCardMode(group.id, 'ready');
}

/**
 * VideoEngine is a headless component: it renders nothing but watches the
 * playback store and drives every active <video> element registered via
 * FloatingVideoCard. Mount once near the App root.
 */
export function VideoEngine(): null {
  const currentTs = usePlayback((s) => s.currentTs);
  const playing = usePlayback((s) => s.playing);
  const speed = usePlayback((s) => s.speed);
  const activeIds = useVideos((s) => s.activeGroupIds);
  const groups = useVideos((s) => s.groups);

  // Pin the latest state in a ref so we can also sync in response to group
  // data arriving after activation (e.g. src swapped mid-playback).
  const lastSyncKey = useRef('');

  useEffect(() => {
    const key = `${currentTs}|${playing}|${speed}|${activeIds.join(',')}|${groups.length}`;
    lastSyncKey.current = key;
    const active = groups.filter((g) => activeIds.includes(g.id));
    for (const g of active) {
      syncOne(g, currentTs, playing, speed);
    }
  }, [currentTs, playing, speed, activeIds, groups]);

  return null;
}
