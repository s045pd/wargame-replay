import { FilePlus2, AlertTriangle } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { formatDurationMs } from './alignMath';
import type { CandidateGroup } from '../lib/api';

interface CandidateGroupCardProps {
  candidate: CandidateGroup;
  onAssociate: (candidate: CandidateGroup) => void;
}

export function CandidateGroupCard({ candidate, onAssociate }: CandidateGroupCardProps) {
  const t = useI18n((s) => s.t);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-zinc-100" title={candidate.autoGroupKey}>
            {candidate.autoGroupKey}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
            <span>
              {candidate.segments.length} {t('video_segments')}
            </span>
            <span>· {formatDurationMs(candidate.totalDurationMs)}</span>
            <span className={candidate.compatible ? 'text-zinc-400' : 'text-amber-400'}>
              · {candidate.codec || '—'}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onAssociate(candidate)}
          className="flex items-center gap-1 rounded bg-sky-500/20 px-2 py-1 text-xs text-sky-200 hover:bg-sky-500/30"
        >
          <FilePlus2 className="h-3 w-3" />
          {t('video_associate')}
        </button>
      </div>
      {!candidate.compatible && (
        <div className="mt-2 flex items-start gap-1 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{t('video_incompatible_warn')}</span>
        </div>
      )}
    </div>
  );
}
