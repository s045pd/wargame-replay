import { useMemo } from 'react';
import type { UnitPosition } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { usePlayback } from '../store/playback';

interface KillLeaderboardProps {
  units: UnitPosition[];
  currentTs: string;
}

interface LeaderEntry {
  id: number;
  name: string;
  team: string;
  kills: number;
}

const TOP_N = 5;

/**
 * Kill leaderboard backed by the pre-fetched full kill list (`allKills`).
 * Uses binary search to count kills up to `currentTs` — accurate regardless
 * of seek, fast-forward, or rewind.
 */
export function KillLeaderboard({ units, currentTs }: KillLeaderboardProps) {
  const { t } = useI18n();
  const allKills = usePlayback(s => s.allKills);

  // Build unit info lookup
  const unitInfo = useMemo(() => {
    const m = new Map<number, { name: string; team: string }>();
    for (const u of units) {
      m.set(u.id, { name: u.name || `#${u.id}`, team: u.team });
    }
    return m;
  }, [units]);

  // Compute leaderboard from allKills filtered by currentTs
  const leaders = useMemo(() => {
    if (!allKills || allKills.length === 0 || !currentTs) return [];

    // allKills is sorted by timestamp from the server.
    // Binary search for the last kill at or before currentTs.
    let lo = 0;
    let hi = allKills.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (allKills[mid].ts <= currentTs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // lo = number of kills with ts <= currentTs

    // Count kills per attacker
    const counts = new Map<number, number>();
    for (let i = 0; i < lo; i++) {
      const src = allKills[i].src;
      counts.set(src, (counts.get(src) || 0) + 1);
    }

    // Build sorted leaderboard
    const entries: LeaderEntry[] = [];
    for (const [id, kills] of counts) {
      const info = unitInfo.get(id);
      entries.push({
        id,
        name: info?.name || `#${id}`,
        team: info?.team || '',
        kills,
      });
    }
    entries.sort((a, b) => b.kills - a.kills);
    return entries.slice(0, TOP_N);
  }, [allKills, currentTs, unitInfo]);

  if (leaders.length === 0) return null;

  return (
    <div className="absolute top-16 right-14 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-2.5 py-2 text-xs font-mono backdrop-blur-sm min-w-[150px]">
      <div className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1.5">
        🏆 {t('kill_leader')}
      </div>
      <div className="space-y-0.5">
        {leaders.map((entry, idx) => {
          const isRed = entry.team === 'red';
          const nameColor = isRed ? 'text-red-400' : 'text-cyan-400';
          const badgeColor = isRed ? 'bg-red-900/60 text-red-300' : 'bg-cyan-900/60 text-cyan-300';
          return (
            <div key={entry.id} className="flex items-center gap-1.5">
              <span className="text-zinc-600 w-3 text-right">{idx + 1}</span>
              <span className={`${nameColor} font-medium truncate flex-1`} style={{ maxWidth: 90 }}>
                {entry.name}
              </span>
              <span className={`${badgeColor} rounded px-1.5 py-0 text-[10px] font-bold`}>
                {entry.kills}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
