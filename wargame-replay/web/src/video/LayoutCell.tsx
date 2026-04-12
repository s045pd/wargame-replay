import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, X } from 'lucide-react';
import { useVideos } from '../store/videos';
import { usePlayback } from '../store/playback';
import {
  registerVideoElement,
  getCardMode,
  subscribeCardMode,
  type VideoCardMode,
} from './VideoEngine';
import { formatOffsetMs } from './alignMath';

interface LayoutCellProps {
  groupId: string;
  mode: 'dock-right' | 'grid-top';
}

/**
 * Non-floating card used by DockedLayout. Fills its flex slot, exposes
 * mute + close controls, and registers its <video> DOM with VideoEngine.
 */
export function LayoutCell({ groupId, mode }: LayoutCellProps) {
  const group = useVideos((s) => s.groups.find((g) => g.id === groupId));
  const players = usePlayback((s) => s.meta?.players ?? []);
  const setActive = useVideos((s) => s.setActive);
  const updateCardState = useVideos((s) => s.updateCardState);
  const cardState = useVideos((s) => s.cardStates[groupId]);

  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [cardMode, setCardModeState] = useState<VideoCardMode>(getCardMode(groupId));
  useEffect(() => {
    return subscribeCardMode(groupId, () => setCardModeState(getCardMode(groupId)));
  }, [groupId]);

  useEffect(() => {
    registerVideoElement(groupId, videoRef.current);
    return () => registerVideoElement(groupId, null);
  }, [groupId]);

  if (!group) return null;

  const player = players.find((p) => p.id === group.unitId);
  const unitName = player?.name ?? `Unit ${group.unitId}`;
  const teamColor = group.unitId < 500 ? 'bg-red-500' : 'bg-sky-400';
  const muted = cardState?.muted ?? true;

  const placeholder =
    cardMode === 'out-of-range'
      ? { icon: '⏱', text: '超出视频范围' }
      : cardMode === 'incompatible'
        ? { icon: '⚠', text: '编码不兼容' }
        : cardMode === 'error'
          ? { icon: '⚠', text: '文件丢失' }
          : cardMode === 'transcoding'
            ? { icon: '⟳', text: '转码中…' }
            : null;

  const cellClasses =
    mode === 'dock-right'
      ? 'relative flex-1 min-h-0 overflow-hidden rounded border border-zinc-800 bg-black'
      : 'relative h-full flex-1 min-w-0 overflow-hidden rounded border border-zinc-800 bg-black';

  return (
    <div className={cellClasses}>
      <div className="absolute left-0 right-0 top-0 z-10 flex h-8 items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-2 text-xs text-zinc-200">
        <span className={`h-2 w-2 shrink-0 rounded-full ${teamColor}`} />
        <span className="truncate font-medium">{unitName}</span>
        <span className="truncate text-zinc-400">· {group.cameraLabel}</span>
        <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
          {formatOffsetMs(group.offsetMs)}
        </span>
        <button
          type="button"
          className="flex h-5 w-5 items-center justify-center rounded hover:bg-zinc-800"
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
          className="flex h-5 w-5 items-center justify-center rounded text-red-300 hover:bg-red-500/20"
          title="关闭"
          onClick={(e) => {
            e.stopPropagation();
            setActive(groupId, false);
          }}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        muted={muted}
        playsInline
        preload="auto"
      />

      {placeholder && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-4 text-center text-xs text-zinc-200">
          <span className="text-2xl">{placeholder.icon}</span>
          <span>{placeholder.text}</span>
        </div>
      )}
    </div>
  );
}
