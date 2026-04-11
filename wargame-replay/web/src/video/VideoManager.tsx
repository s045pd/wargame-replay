import { useState, useEffect } from 'react';
import {
  X,
  RefreshCw,
  Layers,
  PanelRight,
  LayoutGrid,
  AlertTriangle,
  Plus,
  Trash2,
  FolderX,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useVideos, type LayoutMode } from '../store/videos';
import { VideoGroupCard } from './VideoGroupCard';
import { CandidateGroupCard } from './CandidateGroupCard';
import { AlignWizard } from './AlignWizard';
import { AddVideoSourceDialog } from './AddVideoSourceDialog';
import type { CandidateGroup } from '../lib/api';

interface VideoManagerProps {
  open: boolean;
  onClose: () => void;
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));
}

export function VideoManager({ open, onClose }: VideoManagerProps) {
  const t = useI18n((s) => s.t);
  const serverReady = useVideos((s) => s.serverReady);
  const sourceDetails = useVideos((s) => s.sourceDetails);
  const segmentCount = useVideos((s) => s.segmentCount);
  const scanning = useVideos((s) => s.scanning);
  const candidates = useVideos((s) => s.candidates);
  const candidatesLoading = useVideos((s) => s.candidatesLoading);
  const groups = useVideos((s) => s.groups);
  const autoActivate = useVideos((s) => s.autoActivateOnSelect);
  const setAutoActivate = useVideos((s) => s.setAutoActivate);
  const rescan = useVideos((s) => s.rescan);
  const removeSource = useVideos((s) => s.removeSource);
  const layoutMode = useVideos((s) => s.layoutMode);
  const setLayoutMode = useVideos((s) => s.setLayoutMode);
  const loadSources = useVideos((s) => s.loadSources);

  const [wizardCandidate, setWizardCandidate] = useState<CandidateGroup | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Load sources each time the drawer opens so we always show fresh state.
  useEffect(() => {
    if (open) {
      void loadSources();
    }
  }, [open, loadSources]);

  // Close on Escape when open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !wizardCandidate && !addOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, wizardCandidate, addOpen]);

  if (!open) return null;

  const hasSources = sourceDetails.length > 0;
  const staleGroupCount = groups.filter((g) => g.segments.some((s) => s.stale)).length;

  return (
    <>
      <div className="fixed right-0 top-0 z-30 h-full w-[440px] border-l border-zinc-800 bg-zinc-900/95 text-zinc-100 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold">{t('video_title')}</h2>
          <div className="flex items-center gap-1">
            {hasSources && (
              <button
                type="button"
                onClick={() => void rescan()}
                disabled={scanning}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
                title={t('video_rescan')}
              >
                <RefreshCw className={`h-3 w-3 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? t('video_rescanning') : t('video_rescan')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="h-[calc(100%-48px)] overflow-y-auto p-4">
          {!serverReady ? (
            <div className="rounded border border-zinc-800 bg-zinc-950/50 p-4 text-xs text-zinc-400">
              {t('video_disabled')}
            </div>
          ) : (
            <>
              {/* Primary call-to-action: the big "Add source" button */}
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="mb-3 flex w-full items-center justify-center gap-2 rounded border border-sky-600 bg-sky-500/20 px-3 py-3 text-sm font-medium text-sky-100 hover:bg-sky-500/30"
              >
                <Plus className="h-4 w-4" />
                {t('video_add_source_button')}
              </button>

              {/* Sources summary */}
              <SourcesList
                sources={sourceDetails}
                segmentCount={segmentCount}
                onRemove={(p) => {
                  if (confirm(interpolate(t('video_remove_source_confirm'), { path: p }))) {
                    void removeSource(p);
                  }
                }}
                t={t}
              />

              {staleGroupCount > 0 && (
                <div className="mb-3 flex items-start gap-2 rounded border border-red-800 bg-red-950/30 p-2 text-[11px] text-red-300">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{interpolate(t('video_stale_banner'), { n: staleGroupCount })}</span>
                </div>
              )}

              <label className="mb-2 flex cursor-pointer items-center gap-2 rounded border border-zinc-800 bg-zinc-950/30 p-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={autoActivate}
                  onChange={(e) => setAutoActivate(e.target.checked)}
                  className="h-4 w-4 accent-sky-500"
                />
                <span>{t('video_auto_activate')}</span>
              </label>

              <div className="mb-4 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/30 p-2">
                <span className="text-[11px] text-zinc-500">{t('video_layout')}</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <LayoutButton
                    mode="floating"
                    current={layoutMode}
                    onSelect={setLayoutMode}
                    title={t('video_layout_floating')}
                    icon={<Layers className="h-3.5 w-3.5" />}
                  />
                  <LayoutButton
                    mode="dock-right"
                    current={layoutMode}
                    onSelect={setLayoutMode}
                    title={t('video_layout_dock_right')}
                    icon={<PanelRight className="h-3.5 w-3.5" />}
                  />
                  <LayoutButton
                    mode="grid-top"
                    current={layoutMode}
                    onSelect={setLayoutMode}
                    title={t('video_layout_grid_top')}
                    icon={<LayoutGrid className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>

              {/* Associated */}
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {interpolate(t('video_groups_title'), { n: groups.length })}
                </h3>
                {groups.length === 0 ? (
                  <div className="rounded border border-dashed border-zinc-800 p-3 text-[11px] text-zinc-500">
                    {hasSources ? t('video_no_groups_yet') : t('video_no_source_hint')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groups.map((g) => (
                      <VideoGroupCard key={g.id} group={g} />
                    ))}
                  </div>
                )}
              </div>

              {/* Candidates (optional: users can still manually associate) */}
              {hasSources && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    {interpolate(t('video_candidates_title'), { n: candidates.length })}
                  </h3>
                  {candidatesLoading && (
                    <div className="rounded border border-dashed border-zinc-800 p-3 text-[11px] text-zinc-500">
                      …
                    </div>
                  )}
                  {!candidatesLoading && candidates.length === 0 && (
                    <div className="rounded border border-dashed border-zinc-800 p-3 text-[11px] text-zinc-500">
                      {t('video_none_found')}
                    </div>
                  )}
                  {candidates.length > 0 && (
                    <div className="space-y-2">
                      {candidates.map((c) => (
                        <CandidateGroupCard
                          key={c.autoGroupKey}
                          candidate={c}
                          onAssociate={(cand) => setWizardCandidate(cand)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {wizardCandidate && (
        <AlignWizard candidate={wizardCandidate} onClose={() => setWizardCandidate(null)} />
      )}
      {addOpen && <AddVideoSourceDialog onClose={() => setAddOpen(false)} />}
    </>
  );
}

interface SourcesListProps {
  sources: Array<{ path: string; segmentCount: number; exists: boolean }>;
  segmentCount: number;
  onRemove: (path: string) => void;
  t: (key: string) => string;
}

function SourcesList({ sources, segmentCount, onRemove, t }: SourcesListProps) {
  if (sources.length === 0) {
    return null;
  }
  return (
    <div className="mb-3 rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-500">
        <span>
          {t('video_sources_label')} ({sources.length})
        </span>
        <span>
          {segmentCount} {t('video_segments_indexed')}
        </span>
      </div>
      <div className="space-y-1">
        {sources.map((src) => (
          <div
            key={src.path}
            className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] hover:bg-zinc-900"
          >
            {src.exists ? null : (
              <FolderX className="h-3 w-3 shrink-0 text-amber-400" />
            )}
            <span
              className="truncate font-mono text-zinc-300"
              title={src.path}
            >
              {src.path}
            </span>
            <span className="ml-auto shrink-0 text-zinc-500">
              {src.segmentCount}
            </span>
            <button
              type="button"
              onClick={() => onRemove(src.path)}
              className="flex h-5 w-5 items-center justify-center rounded text-red-300 hover:bg-red-500/20"
              title={t('video_remove_source')}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface LayoutButtonProps {
  mode: LayoutMode;
  current: LayoutMode;
  onSelect: (mode: LayoutMode) => void;
  title: string;
  icon: React.ReactNode;
}

function LayoutButton({ mode, current, onSelect, title, icon }: LayoutButtonProps) {
  const active = mode === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      title={title}
      className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-sky-500/20 text-sky-200'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`}
    >
      {icon}
    </button>
  );
}
