import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { usePlayback } from '../store/playback';
import { useVideos } from '../store/videos';
import { parseGameTs, segmentStartMs, formatOffsetMs, formatDurationMs } from './alignMath';
import type { CandidateGroup } from '../lib/api';

interface AlignWizardProps {
  candidate: CandidateGroup;
  onClose: () => void;
}

/**
 * Computes the initial offsetMs suggestion:
 * game_start_ms - first_segment_start_ms.
 *
 * If the game start time is not yet known, returns 0.
 */
function initialOffsetMs(candidate: CandidateGroup, gameStartTs: string | undefined): number {
  if (!gameStartTs) return 0;
  const firstSeg = candidate.segments[0];
  if (!firstSeg) return 0;
  const gameMs = parseGameTs(gameStartTs);
  if (!Number.isFinite(gameMs)) return 0;
  return gameMs - segmentStartMs(firstSeg);
}

const SUGGESTION_KEYS: Array<{ key: string; tKey: string }> = [
  { key: 'head', tKey: 'video_wizard_suggest_head' },
  { key: 'shoulder', tKey: 'video_wizard_suggest_shoulder' },
  { key: 'chest', tKey: 'video_wizard_suggest_chest' },
  { key: 'third', tKey: 'video_wizard_suggest_third' },
  { key: 'drone', tKey: 'video_wizard_suggest_drone' },
];

export function AlignWizard({ candidate, onClose }: AlignWizardProps) {
  const t = useI18n((s) => s.t);
  const players = usePlayback((s) => s.meta?.players ?? []);
  const gameStart = usePlayback((s) => s.meta?.startTime);
  const createGroup = useVideos((s) => s.createGroup);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [cameraLabel, setCameraLabel] = useState('');
  const [offsetMs, setOffsetMs] = useState<number>(() => initialOffsetMs(candidate, gameStart));
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const totalDuration = useMemo(
    () => candidate.segments.reduce((sum, s) => sum + s.durationMs, 0),
    [candidate.segments],
  );

  const filteredPlayers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q));
  }, [players, filter]);

  function bumpOffset(delta: number) {
    setOffsetMs((v) => v + delta);
  }

  function canProceed(): boolean {
    if (step === 1) return unitId !== null && cameraLabel.trim().length > 0;
    return true;
  }

  async function handleSave() {
    if (unitId === null) return;
    setSaving(true);
    const created = await createGroup({
      unitId,
      cameraLabel: cameraLabel.trim(),
      offsetMs,
      segmentRelPaths: candidate.segments.map((s) => s.relPath),
    });
    setSaving(false);
    if (created) onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h2 className="text-sm font-semibold text-zinc-100">{t('video_title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <div className="text-base font-semibold text-zinc-100">
                  {t('video_wizard_step1_title')}
                </div>
                <div className="text-xs text-zinc-400">{t('video_wizard_step1_hint')}</div>
              </div>

              <div>
                <input
                  placeholder={t('video_unit') + ' …'}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500"
                />
                <div className="mt-2 max-h-48 overflow-y-auto rounded border border-zinc-800">
                  {filteredPlayers.length === 0 && (
                    <div className="px-3 py-2 text-xs text-zinc-500">—</div>
                  )}
                  {filteredPlayers.map((p) => {
                    const selected = unitId === p.id;
                    const teamColor = p.id < 500 ? 'bg-red-500' : 'bg-sky-400';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setUnitId(p.id)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                          selected ? 'bg-sky-500/20 text-sky-100' : 'text-zinc-200 hover:bg-zinc-800'
                        }`}
                      >
                        <span className={`h-2 w-2 rounded-full ${teamColor}`} />
                        <span className="truncate">{p.name}</span>
                        <span className="ml-auto text-zinc-500">#{p.id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400" htmlFor="camera-label">
                  {t('video_camera')}
                </label>
                <input
                  id="camera-label"
                  placeholder={t('video_wizard_label_placeholder')}
                  value={cameraLabel}
                  onChange={(e) => setCameraLabel(e.target.value)}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500"
                />
                <div className="mt-2 flex flex-wrap gap-1">
                  {SUGGESTION_KEYS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setCameraLabel(t(s.tKey))}
                      className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-sky-500 hover:text-sky-200"
                    >
                      {t(s.tKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <div className="text-base font-semibold text-zinc-100">
                  {t('video_wizard_step2_title')}
                </div>
                <div className="text-xs text-zinc-400">{t('video_wizard_step2_hint')}</div>
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
                <div className="flex justify-between text-zinc-400">
                  <span>Game start</span>
                  <span className="font-mono text-zinc-200">{gameStart ?? '—'}</span>
                </div>
                <div className="mt-1 flex justify-between text-zinc-400">
                  <span>First segment creation_time</span>
                  <span className="font-mono text-zinc-200">
                    {candidate.segments[0]?.startTs ?? '—'}
                  </span>
                </div>
                <div className="mt-2 flex justify-between border-t border-zinc-800 pt-2 text-zinc-300">
                  <span>{t('video_offset')}</span>
                  <span className="font-mono text-sm">{formatOffsetMs(offsetMs)}</span>
                </div>
              </div>

              <div>
                <div className="text-xs text-zinc-400">{t('video_offset_nudge_help')}</div>
                <div className="mt-2 grid grid-cols-6 gap-1">
                  {[-10000, -1000, -100, 100, 1000, 10000].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => bumpOffset(delta)}
                      className="rounded border border-zinc-700 bg-zinc-950 px-1 py-1 text-[11px] text-zinc-200 hover:border-sky-500 hover:text-sky-200"
                    >
                      {delta > 0 ? '+' : ''}
                      {delta / 1000}s
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm text-zinc-200">
              <div className="text-base font-semibold">{t('video_wizard_step3_title')}</div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
                <dt className="text-zinc-500">{t('video_unit')}</dt>
                <dd>{players.find((p) => p.id === unitId)?.name ?? unitId}</dd>
                <dt className="text-zinc-500">{t('video_camera')}</dt>
                <dd>{cameraLabel}</dd>
                <dt className="text-zinc-500">{t('video_offset')}</dt>
                <dd className="font-mono">{formatOffsetMs(offsetMs)}</dd>
                <dt className="text-zinc-500">{t('video_segments')}</dt>
                <dd>{candidate.segments.length}</dd>
                <dt className="text-zinc-500">{t('video_duration')}</dt>
                <dd>{formatDurationMs(totalDuration)}</dd>
                <dt className="text-zinc-500">{t('video_codec')}</dt>
                <dd className={candidate.compatible ? '' : 'text-amber-400'}>
                  {candidate.codec}
                </dd>
              </dl>
              {!candidate.compatible && (
                <div className="rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  {t('video_incompatible_warn')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {t('video_wizard_cancel')}
          </button>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                {t('video_wizard_back')}
              </button>
            )}
            {step < 3 && (
              <button
                type="button"
                disabled={!canProceed()}
                onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)}
                className="rounded bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                {t('video_wizard_next')}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  void handleSave();
                }}
                className="rounded bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
              >
                {t('video_wizard_save')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
