// ── Web Worker: runs sql.js + GameService in background thread ──

import initSqlJs from 'sql.js';
import type { WorkerRequest, WorkerResponse } from './types';
import { GameService } from './service';

let service: GameService | null = null;

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  try {
    switch (req.type) {
      case 'init': {
        post({ type: 'progress', stage: 'Loading SQL.js...', percent: 0 });

        const SQL = await initSqlJs({
          // WASM URL is passed from main thread to work in both dev and prod
          locateFile: () => req.wasmUrl,
        });

        post({ type: 'progress', stage: 'Opening database...', percent: 3 });
        const db = new SQL.Database(new Uint8Array(req.dbBuffer));

        service = GameService.load(db, req.txtContent, (stage, percent) => {
          post({ type: 'progress', stage, percent });
        });

        post({
          type: 'ready',
          meta: service.meta,
          hotspots: service.hotspots,
          allKills: service.allKills,
          timestamps: service.timeIndex.allTimestamps(),
        });
        break;
      }

      case 'getFrame': {
        if (!service) { post({ type: 'error', message: 'Service not initialized' }); return; }
        const frame = service.getFrame(req.ts);
        if (frame) post({ type: 'frame', frame });
        else post({ type: 'error', message: `No frame at ${req.ts}` });
        break;
      }

      case 'getFrameRange': {
        if (!service) { post({ type: 'error', message: 'Service not initialized' }); return; }
        const frame = service.getFrameRange(req.fromTs, req.ts);
        if (frame) post({ type: 'frame', frame });
        else post({ type: 'error', message: `No frame range ${req.fromTs}..${req.ts}` });
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', message: String(err) });
  }
};
