// ── Time index ported from Go index/timeindex.go ──

import type { Database } from 'sql.js';

export class TimeIndex {
  private timestamps: string[] = [];

  static build(db: Database): TimeIndex {
    const idx = new TimeIndex();
    const stmt = db.prepare(`
      SELECT DISTINCT LogTime
      FROM record
      WHERE SrcType=1 AND DataType=1
      GROUP BY LogTime
      ORDER BY LogTime
    `);
    while (stmt.step()) {
      idx.timestamps.push(stmt.get()[0] as string);
    }
    stmt.free();
    return idx;
  }

  get length(): number {
    return this.timestamps.length;
  }

  startTime(): string {
    return this.timestamps[0] ?? '';
  }

  endTime(): string {
    return this.timestamps[this.timestamps.length - 1] ?? '';
  }

  timestampAt(offset: number): string | null {
    if (offset < 0 || offset >= this.timestamps.length) return null;
    return this.timestamps[offset]!;
  }

  /** Binary search for the index of the closest timestamp >= ts. */
  indexOf(ts: string): number {
    let lo = 0, hi = this.timestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timestamps[mid]! < ts) lo = mid + 1;
      else hi = mid;
    }
    return Math.min(lo, this.timestamps.length - 1);
  }

  /** Check if timestamp exists in index. */
  has(ts: string): boolean {
    const i = this.indexOf(ts);
    return i >= 0 && i < this.timestamps.length && this.timestamps[i] === ts;
  }

  /** Return a copy of all timestamps (for sending to main thread). */
  allTimestamps(): string[] {
    return this.timestamps.slice();
  }
}
