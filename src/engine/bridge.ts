// ── Main thread ↔ Worker bridge ──

import type { WorkerRequest, WorkerResponse, GameMeta, HotspotEvent, GameEvent, Frame } from './types';

type ProgressCallback = (stage: string, percent: number) => void;

interface InitResult {
  meta: GameMeta;
  hotspots: HotspotEvent[];
  allKills: GameEvent[];
  timestamps: string[];
}

export class EngineBridge {
  private worker: Worker;
  private frameResolve: ((frame: Frame) => void) | null = null;
  private frameReject: ((err: Error) => void) | null = null;
  private initResolve: ((result: InitResult) => void) | null = null;
  private initReject: ((err: Error) => void) | null = null;
  private onProgress: ProgressCallback | null = null;

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = (e) => {
      const err = new Error(`Worker error: ${e.message}`);
      console.error('[EngineBridge] Worker error:', e);
      if (this.initReject) {
        this.initReject(err);
        this.initResolve = null;
        this.initReject = null;
      } else if (this.frameReject) {
        this.frameReject(err);
        this.frameResolve = null;
        this.frameReject = null;
      }
    };
  }

  private send(msg: WorkerRequest) {
    if (msg.type === 'init') {
      // Transfer the ArrayBuffer for zero-copy
      this.worker.postMessage(msg, [msg.dbBuffer]);
    } else {
      this.worker.postMessage(msg);
    }
  }

  private handleMessage(e: MessageEvent<WorkerResponse>) {
    const msg = e.data;
    switch (msg.type) {
      case 'ready':
        this.initResolve?.({
          meta: msg.meta,
          hotspots: msg.hotspots,
          allKills: msg.allKills,
          timestamps: msg.timestamps,
        });
        this.initResolve = null;
        this.initReject = null;
        break;
      case 'frame':
        this.frameResolve?.(msg.frame);
        this.frameResolve = null;
        this.frameReject = null;
        break;
      case 'error':
        if (this.initReject) {
          this.initReject(new Error(msg.message));
          this.initResolve = null;
          this.initReject = null;
        } else if (this.frameReject) {
          this.frameReject(new Error(msg.message));
          this.frameResolve = null;
          this.frameReject = null;
        }
        break;
      case 'progress':
        this.onProgress?.(msg.stage, msg.percent);
        break;
    }
  }

  /** Initialize the engine with a .db file buffer and optional .txt content. */
  async init(
    dbBuffer: ArrayBuffer,
    txtContent?: string,
    onProgress?: ProgressCallback,
  ): Promise<InitResult> {
    this.onProgress = onProgress ?? null;
    return new Promise((resolve, reject) => {
      this.initResolve = resolve;
      this.initReject = reject;
      // Compute absolute WASM URL from main thread — works in both dev and prod
      const wasmUrl = new URL(import.meta.env.BASE_URL + 'sql-wasm.wasm', window.location.href).href;
      this.send({ type: 'init', dbBuffer, txtContent, wasmUrl });
    });
  }

  /** Request a frame at timestamp. */
  async getFrame(ts: string): Promise<Frame> {
    return new Promise((resolve, reject) => {
      this.frameResolve = resolve;
      this.frameReject = reject;
      this.send({ type: 'getFrame', ts });
    });
  }

  /** Request a frame with event range for fast-forward. */
  async getFrameRange(fromTs: string, ts: string): Promise<Frame> {
    return new Promise((resolve, reject) => {
      this.frameResolve = resolve;
      this.frameReject = reject;
      this.send({ type: 'getFrameRange', fromTs, ts });
    });
  }

  /** Terminate the worker. */
  dispose() {
    this.worker.terminate();
  }
}
