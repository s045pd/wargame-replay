import { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, Minus, Square, X } from 'lucide-react';
import { useVideos, getCardState } from '../store/videos';
import { usePlayback } from '../store/playback';
import {
  registerVideoElement,
  getCardMode,
  subscribeCardMode,
  type VideoCardMode,
} from './VideoEngine';
import { formatOffsetMs } from './alignMath';

interface FloatingVideoCardProps {
  groupId: string;
  index: number;
}

const DEFAULT_W = 360;
const DEFAULT_H = 220;
const MIN_W = 220;
const MIN_H = 140;

function defaultPosition(index: number, w: number, h: number): { x: number; y: number } {
  // Stack cards from the bottom-right corner going up-left.
  const margin = 16;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 900;
  return {
    x: Math.max(margin, viewportW - w - margin - index * 24),
    y: Math.max(margin, viewportH - h - margin - index * 24),
  };
}

export function FloatingVideoCard({ groupId, index }: FloatingVideoCardProps) {
  const group = useVideos((s) => s.groups.find((g) => g.id === groupId));
  const players = usePlayback((s) => s.meta?.players ?? []);
  const setActive = useVideos((s) => s.setActive);
  const updateCardState = useVideos((s) => s.updateCardState);
  const updateGroup = useVideos((s) => s.updateGroup);
  const cardState = useVideos((s) => s.cardStates[groupId]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Subscribe to engine-side mode (error/out-of-range/incompatible).
  const [mode, setMode] = useState<VideoCardMode>(getCardMode(groupId));
  useEffect(() => {
    return subscribeCardMode(groupId, () => setMode(getCardMode(groupId)));
  }, [groupId]);

  // Position / size defaults when no persisted state yet.
  const resolvedW = cardState?.w ?? DEFAULT_W;
  const resolvedH = cardState?.h ?? DEFAULT_H;
  const defaultPos = defaultPosition(index, resolvedW, resolvedH);
  const xInit = cardState && cardState.x >= 0 ? cardState.x : defaultPos.x;
  const yInit = cardState && cardState.y >= 0 ? cardState.y : defaultPos.y;
  const [pos, setPos] = useState({ x: xInit, y: yInit });
  const [size, setSize] = useState({ w: resolvedW, h: resolvedH });

  // Keep local position in sync if persisted state was just hydrated.
  useEffect(() => {
    if (cardState && cardState.x >= 0 && cardState.y >= 0) {
      setPos({ x: cardState.x, y: cardState.y });
    }
    if (cardState) {
      setSize({ w: cardState.w, h: cardState.h });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  // Register <video> element with the engine.
  useEffect(() => {
    registerVideoElement(groupId, videoRef.current);
    return () => registerVideoElement(groupId, null);
  }, [groupId]);

  // Drag to move.
  const dragStart = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('button')) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragStart.current = { startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y };
    },
    [pos.x, pos.y],
  );
  const onHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.startX;
    const dy = e.clientY - dragStart.current.startY;
    setPos({ x: dragStart.current.baseX + dx, y: dragStart.current.baseY + dy });
  }, []);
  const onHeaderPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart.current) return;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      dragStart.current = null;
      updateCardState(groupId, { x: pos.x, y: pos.y });
    },
    [groupId, pos.x, pos.y, updateCardState],
  );

  // Resize via bottom-right handle.
  const resizeStart = useRef<{
    startX: number;
    startY: number;
    baseW: number;
    baseH: number;
  } | null>(null);
  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      resizeStart.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseW: size.w,
        baseH: size.h,
      };
    },
    [size.w, size.h],
  );
  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeStart.current) return;
    const dw = e.clientX - resizeStart.current.startX;
    const dh = e.clientY - resizeStart.current.startY;
    setSize({
      w: Math.max(MIN_W, resizeStart.current.baseW + dw),
      h: Math.max(MIN_H, resizeStart.current.baseH + dh),
    });
  }, []);
  const onResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizeStart.current) return;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      resizeStart.current = null;
      updateCardState(groupId, { w: size.w, h: size.h });
    },
    [groupId, size.w, size.h, updateCardState],
  );

  if (!group) return null;

  const player = players.find((p) => p.id === group.unitId);
  const unitName = player?.name ?? `Unit ${group.unitId}`;
  const teamColor = group.unitId < 500 ? 'bg-red-500' : 'bg-sky-400';
  const minimized = cardState?.minimized ?? false;
  const muted = cardState?.muted ?? true;

  const placeholder =
    mode === 'out-of-range'
      ? { icon: '⏱', text: '超出视频时间范围' }
      : mode === 'incompatible'
        ? { icon: '⚠', text: '浏览器不支持该编码 — 需用 ffmpeg 转为 H.264' }
        : mode === 'error'
          ? { icon: '⚠', text: '视频加载失败 — 文件可能已移动' }
          : null;

  return (
    <div
      ref={cardRef}
      className="pointer-events-auto fixed z-40 overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-900/95 shadow-2xl backdrop-blur"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: minimized ? 36 : size.h,
      }}
    >
      <div
        className="flex h-9 cursor-move select-none items-center gap-2 border-b border-zinc-800 bg-zinc-950/80 px-3 text-xs text-zinc-200"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <span className={`h-2 w-2 rounded-full ${teamColor}`} />
        <span className="truncate font-medium">{unitName}</span>
        <span className="truncate text-zinc-400">· {group.cameraLabel}</span>
        <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
          {formatOffsetMs(group.offsetMs)}
        </span>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-800"
          title={muted ? '取消静音' : '静音'}
          onClick={(e) => {
            e.stopPropagation();
            const next = !muted;
            updateCardState(groupId, { muted: next });
            if (videoRef.current) videoRef.current.muted = next;
          }}
        >
          {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-800"
          title={minimized ? '展开' : '最小化'}
          onClick={(e) => {
            e.stopPropagation();
            updateCardState(groupId, { minimized: !minimized });
          }}
        >
          {minimized ? <Square className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded text-red-300 hover:bg-red-500/20"
          title="关闭"
          onClick={(e) => {
            e.stopPropagation();
            setActive(groupId, false);
          }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {!minimized && (
        <div className="relative h-[calc(100%-36px)] w-full bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-contain"
            muted={muted}
            playsInline
            preload="auto"
            onError={() => {
              // The engine will update its mode on the next sync.
              void updateGroup(groupId, {});
            }}
          />
          {placeholder && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-4 text-center text-sm text-zinc-200">
              <span className="text-3xl">{placeholder.icon}</span>
              <span>{placeholder.text}</span>
            </div>
          )}
          <div
            className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize bg-zinc-700"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
          />
        </div>
      )}
    </div>
  );
}

// Keep the unused imports from being stripped and help the prop type reader.
void getCardState;
