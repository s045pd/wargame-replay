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

/** A recorded kill event for accurate rewind support */
interface KillRecord {
  src: number;
  dst: number;
  ts: string;
}

const TOP_N = 5;

/**
 * Real-time kill leaderboard.
 * Accumulates kill events over time.  On time-jump backwards (seek / director
 * seek-back), only discards kills that happened AFTER the new timestamp so the
 * cumulative total stays correct.
 */
export function KillLeaderboard({ events, units, currentTs }: KillLeaderboardProps) {
  const { t } = useI18n();
  /** Full ordered list of kill events seen so far */
  const killLogRef = useRef<KillRecord[]>([]);
  /** Fast dedup set: "src_dst_ts" → avoid double-counting the same event */
  const seenRef = useRef(new Set<string>());
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
    let dirty = false;

    // Detect time-jump backwards (seek) — trim kill log instead of clearing
    if (currentTs && lastTsRef.current && currentTs < lastTsRef.current) {
      const log = killLogRef.current;
      // Find the first entry that is AFTER the new currentTs and trim from there
      let cutIdx = log.length;
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].ts <= currentTs) break;
        cutIdx = i;
      }
      if (cutIdx < log.length) {
        // Remove future entries from dedup set
        for (let i = cutIdx; i < log.length; i++) {
          // Rebuild dedup key — we only stored src+ts, need to remove all matching keys
          // Since seenRef stores "src_dst_ts", and we don't have dst here, rebuild the
          // entire seen set from the trimmed log.  Kills are rare enough that this is fine.
        }
        log.length = cutIdx;
        // Rebuild seen set from remaining log entries
        seenRef.current.clear();
        // Note: seen set keys include dst which we don't store in killLog.
        // That's OK — after trimming, incoming events will re-dedup correctly
        // because events for timestamps <= currentTs will re-arrive in future frames.
        // To avoid re-counting them, we rebuild from the log.
        // We mark all remaining log entries as "seen" with a simpler key.
        for (const rec of log) {
          seenRef.current.add(`${rec.src}_${rec.dst}_${rec.ts}`);
        }
        dirty = true;
      }
    }
    lastTsRef.current = currentTs;

    // Accumulate kill events from this frame
    for (const ev of events) {
      if (ev.type !== 'kill') continue;
      // Dedup: same killer + same victim + same timestamp = same kill event
      const dst = ev.dst ?? 0;
      const key = `${ev.src}_${dst}_${ev.ts}`;
      if (seenRef.current.has(key)) continue;
      seenRef.current.add(key);
      killLogRef.current.push({ src: ev.src, dst, ts: ev.ts });
      dirty = true;
    }

    if (!dirty && killLogRef.current.length > 0) return;

    // Rebuild sorted leaderboard from kill log
    const counts = new Map<number, number>();
    for (const rec of killLogRef.current) {
      counts.set(rec.src, (counts.get(rec.src) || 0) + 1);
    }

    const entries: LeaderEntry[] = [];
    for (const [id, kills] of counts) {
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
