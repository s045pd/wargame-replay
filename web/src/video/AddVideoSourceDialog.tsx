import { useMemo, useState } from 'react';
import { X, Check, AlertTriangle } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { usePlayback } from '../store/playback';
import { useVideos } from '../store/videos';
import { DirectoryPicker } from './DirectoryPicker';

interface AddVideoSourceDialogProps {
  onClose: () => void;
}

type Step = 'pick-unit' | 'pick-directory' | 'review';

const SUGGESTION_KEYS: Array<{ key: string; tKey: string }> = [
  { key: 'head', tKey: 'video_wizard_suggest_head' },
  { key: 'shoulder', tKey: 'video_wizard_suggest_shoulder' },
  { key: 'chest', tKey: 'video_wizard_suggest_chest' },
  { key: 'third', tKey: 'video_wizard_suggest_third' },
  { key: 'drone', tKey: 'video_wizard_suggest_drone' },
];

/**
 * 3-step dialog:
 *   1. Pick a unit from the current game's player list.
 *   2. Pick a directory with the server-driven DirectoryPicker.
 *   3. Review the choice, then POST /quick-add to create the group.
 *
 * quick-add on the backend: registers the directory as a source if it
 * is not already, scans, auto-groups, picks the longest-duration group,
 * auto-aligns to the game start, and saves. The user never has to think
 * about "sources" vs "groups".
 */
export function AddVideoSourceDialog({ onClose }: AddVideoSourceDialogProps) {
  const t = useI18n((s) => s.t);
  const players = usePlayback((s) => s.meta?.players ?? []);
  const quickAdd = useVideos((s) => s.quickAdd);

  const [step, setStep] = useState<Step>('pick-unit');
  const [unitId, setUnitId] = useState<number | null>(null);
  const [cameraLabel, setCameraLabel] = useState('');
  const [directory, setDirectory] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredPlayers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q),
    );
  }, [players, filter]);

  const selectedUnit = players.find((p) => p.id === unitId) ?? null;

  async function handleSave() {
    if (unitId === null || !directory) return;
    setSaving(true);
    setError(null);
    const group = await quickAdd({
      unitId,
      cameraLabel: cameraLabel.trim() || t('video_wizard_suggest_head'),
      directory,
    });
    setSaving(false);
    if (group) {
      onClose();
    } else {
      const storeErr = useVideos.getState().groupsError;
      setError(storeErr ?? t('video_quick_add_failed'));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      {step === 'pick-directory' ? (
        <DirectoryPicker
          initialPath={directory ?? undefined}
          onCancel={() => setStep('pick-unit')}
          onConfirm={(abs) => {
            setDirectory(abs);
            setStep('review');
          }}
        />
      ) : (
        <div className="w-full max-w-xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
            <h2 className="text-sm font-semibold text-zinc-100">
              {t('video_add_source_title')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="p-5">
            {step === 'pick-unit' && (
              <div className="space-y-4">
                <div>
                  <div className="text-base font-semibold text-zinc-100">
                    {t('video_wizard_step1_title')}
                  </div>
                  <div className="text-xs text-zinc-400">
                    {t('video_wizard_step1_hint')}
                  </div>
                </div>

                <div>
                  <input
                    placeholder={t('video_unit') + ' …'}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-sky-500"
                  />
                  <div className="mt-2 max-h-60 overflow-y-auto rounded border border-zinc-800">
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
                            selected
                              ? 'bg-sky-500/20 text-sky-100'
                              : 'text-zinc-200 hover:bg-zinc-800'
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

            {step === 'review' && (
              <div className="space-y-3 text-sm text-zinc-200">
                <div className="text-base font-semibold">
                  {t('video_add_source_review_title')}
                </div>
                <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 rounded border border-zinc-800 bg-zinc-950/50 p-3 text-xs">
                  <dt className="text-zinc-500">{t('video_unit')}</dt>
                  <dd>{selectedUnit?.name ?? unitId}</dd>
                  <dt className="text-zinc-500">{t('video_camera')}</dt>
                  <dd>{cameraLabel || t('video_wizard_suggest_head')}</dd>
                  <dt className="text-zinc-500">{t('video_directory')}</dt>
                  <dd className="truncate font-mono text-[11px]" title={directory ?? ''}>
                    {directory}
                  </dd>
                </dl>
                <div className="rounded border border-zinc-800 bg-zinc-950/50 p-3 text-xs text-zinc-400">
                  {t('video_add_source_note')}
                </div>
                {error && (
                  <div className="flex items-start gap-2 rounded border border-red-800 bg-red-950/30 p-2 text-xs text-red-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{error}</span>
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
              {step === 'review' && (
                <button
                  type="button"
                  onClick={() => setStep('pick-unit')}
                  className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800"
                >
                  {t('video_wizard_back')}
                </button>
              )}
              {step === 'pick-unit' && (
                <button
                  type="button"
                  disabled={unitId === null}
                  onClick={() => setStep('pick-directory')}
                  className="rounded bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  {t('video_add_source_pick_dir')}
                </button>
              )}
              {step === 'review' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void handleSave();
                  }}
                  className="flex items-center gap-1 rounded bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
                >
                  <Check className="h-3 w-3" />
                  {t('video_add_source_save')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
