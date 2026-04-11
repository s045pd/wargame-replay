import { useState } from 'react';
import { Trash2, Check, Eye, EyeOff, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { usePlayback } from '../store/playback';
import { useVideos } from '../store/videos';
import { formatDurationMs, formatOffsetMs } from './alignMath';
import type { VideoGroup } from '../lib/api';

interface VideoGroupCardProps {
  group: VideoGroup;
}

export function VideoGroupCard({ group }: VideoGroupCardProps) {
  const t = useI18n((s) => s.t);
  const players = usePlayback((s) => s.meta?.players ?? []);
  const active = useVideos((s) => s.activeGroupIds.includes(group.id));
  const setActive = useVideos((s) => s.setActive);
  const updateGroup = useVideos((s) => s.updateGroup);
  const deleteGroup = useVideos((s) => s.deleteGroup);

  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(group.cameraLabel);

  const player = players.find((p) => p.id === group.unitId);
  const unitName = player?.name ?? `${t('video_unit')} ${group.unitId}`;
  const teamColor = group.unitId < 500 ? 'bg-red-500' : 'bg-sky-400';
  const totalDurationMs = group.segments.reduce((sum, s) => sum + s.durationMs, 0);
  const anyIncompatible = group.segments.some((s) => !s.compatible);

  function nudge(deltaMs: number) {
    void updateGroup(group.id, { offsetMs: group.offsetMs + deltaMs });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="flex items-start gap-2">
        <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${teamColor}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100">{unitName}</div>
          {editingLabel ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void updateGroup(group.id, { cameraLabel: labelDraft });
                setEditingLabel(false);
              }}
              className="mt-1 flex items-center gap-1"
            >
              <input
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-100 outline-none focus:border-sky-500"
                autoFocus
              />
              <button
                type="submit"
                className="flex h-6 w-6 items-center justify-center rounded text-zinc-200 hover:bg-zinc-800"
              >
                <Check className="h-3 w-3" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="truncate text-left text-xs text-zinc-400 hover:text-zinc-200"
              onClick={() => setEditingLabel(true)}
              title={t('video_edit_label')}
            >
              {group.cameraLabel}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setActive(group.id, !active)}
          className={`flex h-7 w-7 items-center justify-center rounded ${
            active ? 'bg-sky-500/20 text-sky-300' : 'text-zinc-400 hover:bg-zinc-800'
          }`}
          title={active ? t('video_deactivate') : t('video_activate')}
        >
          {active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => void deleteGroup(group.id)}
          className="flex h-7 w-7 items-center justify-center rounded text-red-300 hover:bg-red-500/20"
          title={t('video_delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-zinc-400">
        <div>
          <span className="text-zinc-500">{t('video_segments')}: </span>
          <span className="text-zinc-300">{group.segments.length}</span>
        </div>
        <div>
          <span className="text-zinc-500">{t('video_duration')}: </span>
          <span className="text-zinc-300">{formatDurationMs(totalDurationMs)}</span>
        </div>
        <div className="truncate">
          <span className="text-zinc-500">{t('video_codec')}: </span>
          <span className={anyIncompatible ? 'text-amber-400' : 'text-zinc-300'}>
            {group.segments[0]?.codec ?? '—'}
          </span>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1">
        <span className="text-[11px] text-zinc-500">{t('video_offset')}:</span>
        <span className="text-[11px] font-mono text-zinc-200">{formatOffsetMs(group.offsetMs)}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => nudge(-10000)}
            className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-zinc-300 hover:bg-zinc-800"
            title="-10s"
          >
            <ChevronsLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => nudge(-1000)}
            className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-zinc-300 hover:bg-zinc-800"
            title="-1s"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => nudge(-100)}
            className="h-5 rounded px-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
            title="-100ms"
          >
            -0.1
          </button>
          <button
            type="button"
            onClick={() => nudge(100)}
            className="h-5 rounded px-1 text-[10px] text-zinc-300 hover:bg-zinc-800"
            title="+100ms"
          >
            +0.1
          </button>
          <button
            type="button"
            onClick={() => nudge(1000)}
            className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-zinc-300 hover:bg-zinc-800"
            title="+1s"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => nudge(10000)}
            className="flex h-5 w-5 items-center justify-center rounded text-[10px] text-zinc-300 hover:bg-zinc-800"
            title="+10s"
          >
            <ChevronsRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {anyIncompatible && (
        <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          {t('video_incompatible_warn')}
        </div>
      )}
    </div>
  );
}
