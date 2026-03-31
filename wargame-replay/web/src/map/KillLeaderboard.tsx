import { useEffect, useRef, useState } from 'react';
import { GameEvent, UnitPosition } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface KillLeaderboardProps {
  events: GameEvent[];
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
 * Real-time kill leaderboard.
 * Accumulates kill events over time, resets on time-jump backwards.
 */
export function KillLeaderboard({ events, units, currentTs }: KillLeaderboardProps) {
  const { t } = useI18n();
  const killCountsRef = useRef(new Map<number, number>());
  const lastTsRef = useRef('');
  const [leaders, setLeaders] = useState<LeaderEntry[]>([]);

  // Build team/name lookup
  const unitInfoRef = useRef(new Map<number, { name: string; team: string }>());
  useEffect(() => {
    const m = new Map<number, { name: string; team: string }>();
    for (const u of units) {
      m.set(u.id, { name: u.name || `#${u.id}`, team: u.team });
    }
    unitInfoRef.current = m;
  }, [units]);

  useEffect(() => {
    // Detect time-jump backwards (seek) — reset kill counts
    if (currentTs && lastTsRef.current && currentTs < lastTsRef.current) {
      killCountsRef.current.clear();
    }
    lastTsRef.current = currentTs;

    // Accumulate kill events
    let changed = false;
    for (const ev of events) {
      if (ev.type !== 'kill') continue;
      const prev = killCountsRef.current.get(ev.src) || 0;
      killCountsRef.current.set(ev.src, prev + 1);
      changed = true;
    }

    if (!changed && leaders.length > 0) return;

    // Build sorted leaderboard
    const entries: LeaderEntry[] = [];
    for (const [id, kills] of killCountsRef.current) {
      const info = unitInfoRef.current.get(id);
      entries.push({
        id,
        name: info?.name || `#${id}`,
        team: info?.team || '',
        kills,
      });
    }
    entries.sort((a, b) => b.kills - a.kills);
    setLeaders(entries.slice(0, TOP_N));
  }, [events, currentTs]);

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
