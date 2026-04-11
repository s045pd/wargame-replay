import { useState, useEffect } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useVideos } from '../store/videos';
import { VideoGroupCard } from './VideoGroupCard';
import { CandidateGroupCard } from './CandidateGroupCard';
import { AlignWizard } from './AlignWizard';
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
  const serverEnabled = useVideos((s) => s.serverEnabled);
  const rootDir = useVideos((s) => s.rootDir);
  const segmentCount = useVideos((s) => s.segmentCount);
  const scanning = useVideos((s) => s.scanning);
  const candidates = useVideos((s) => s.candidates);
  const candidatesLoading = useVideos((s) => s.candidatesLoading);
  const groups = useVideos((s) => s.groups);
  const autoActivate = useVideos((s) => s.autoActivateOnSelect);
  const setAutoActivate = useVideos((s) => s.setAutoActivate);
  const rescan = useVideos((s) => s.rescan);

  const [wizardCandidate, setWizardCandidate] = useState<CandidateGroup | null>(null);

  // Close on Escape when open.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !wizardCandidate) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, wizardCandidate]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed right-0 top-0 z-30 h-full w-[420px] border-l border-zinc-800 bg-zinc-900/95 text-zinc-100 shadow-2xl backdrop-blur"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t('video_title')}</h2>
          </div>
          <div className="flex items-center gap-1">
            {serverEnabled && (
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
          {!serverEnabled ? (
            <div className="rounded border border-zinc-800 bg-zinc-950/50 p-4 text-xs text-zinc-400">
              {t('video_disabled')}
            </div>
          ) : (
            <>
              <div className="mb-3 rounded border border-zinc-800 bg-zinc-950/40 p-2 text-[11px] text-zinc-400">
                {interpolate(t('video_status'), { count: segmentCount, root: rootDir })}
              </div>

              <label className="mb-4 flex cursor-pointer items-center gap-2 rounded border border-zinc-800 bg-zinc-950/30 p-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={autoActivate}
                  onChange={(e) => setAutoActivate(e.target.checked)}
                  className="h-4 w-4 accent-sky-500"
                />
                <span>{t('video_auto_activate')}</span>
              </label>

              {/* Associated */}
              <div className="mb-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {interpolate(t('video_groups_title'), { n: groups.length })}
                </h3>
                {groups.length === 0 ? (
                  <div className="rounded border border-dashed border-zinc-800 p-3 text-[11px] text-zinc-500">
                    —
                  </div>
                ) : (
                  <div className="space-y-2">
                    {groups.map((g) => (
                      <VideoGroupCard key={g.id} group={g} />
                    ))}
                  </div>
                )}
              </div>

              {/* Candidates */}
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
            </>
          )}
        </div>
      </div>

      {wizardCandidate && (
        <AlignWizard candidate={wizardCandidate} onClose={() => setWizardCandidate(null)} />
      )}
    </>
  );
}
