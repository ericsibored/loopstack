/**
 * DenoiseProcessor (§4.5) — post-capture noise reduction behind a swappable
 * backend interface.
 *
 * The `DenoiseBackend` interface is the point of this file. rnnoise is one
 * implementation; the library choice is still open (§10), so nothing outside
 * this module should ever import from the worker or know about 480-sample
 * frames.
 */

import rnnoiseWasmUrl from '@jitsi/rnnoise-wasm/dist/rnnoise.wasm?url';
import { RNNOISE_SAMPLE_RATE } from './constants';
import type { DenoiseBackend } from './types';
import type { DenoiseRequest, DenoiseResponse } from '../workers/denoise.worker';

export interface DenoiseStats {
  /** Time spent inside the model, excluding resampling and transfer. */
  processMs: number;
  /** Mean voice-activity probability the model reported. */
  meanVad: number;
  /** One-time WASM load cost, on the first call only. */
  loadMs: number | null;
  /** Whether the input had to be resampled to 48 kHz and back. */
  resampled: boolean;
}

export class RnnoiseBackend implements DenoiseBackend {
  readonly name = 'rnnoise-wasm';

  private worker: Worker | null = null;
  private ready: Promise<number> | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (r: Float32Array) => void; reject: (e: Error) => void }
  >();

  private lastStats: DenoiseStats | null = null;
  private loadMs: number | null = null;

  /** Stats from the most recent `process()` call. Used by the Phase 0 spike UI. */
  getLastStats(): DenoiseStats | null {
    return this.lastStats;
  }

  /**
   * Loads the WASM module. Safe to call early to warm it up; `process()` calls
   * it anyway.
   */
  init(): Promise<number> {
    if (this.ready) return this.ready;

    const worker = new Worker(new URL('../workers/denoise.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;

    this.ready = new Promise<number>((resolve, reject) => {
      const onReady = (event: MessageEvent<DenoiseResponse>) => {
        const data = event.data;
        if (data.type === 'ready') {
          this.loadMs = data.loadMs;
          resolve(data.loadMs);
        } else if (data.type === 'error' && data.id === undefined) {
          reject(new Error(data.message));
        }
      };
      worker.addEventListener('message', onReady);
      worker.addEventListener('error', (e) => reject(new Error(e.message)));

      const request: DenoiseRequest = { type: 'init', wasmUrl: rnnoiseWasmUrl };
      worker.postMessage(request);
    });

    worker.addEventListener('message', (event: MessageEvent<DenoiseResponse>) => {
      const data = event.data;
      if (data.type === 'result') {
        const entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        this.lastStats = {
          processMs: data.elapsedMs,
          meanVad: data.meanVad,
          loadMs: this.loadMs,
          resampled: this.lastStats?.resampled ?? false,
        };
        entry.resolve(data.samples);
      } else if (data.type === 'error' && data.id !== undefined) {
        const entry = this.pending.get(data.id);
        if (!entry) return;
        this.pending.delete(data.id);
        entry.reject(new Error(data.message));
      }
    });

    return this.ready;
  }

  async process(samples: Float32Array, sampleRate: number): Promise<Float32Array> {
    await this.init();
    const worker = this.worker;
    if (!worker) throw new Error('Denoise worker unavailable');

    const needsResample = sampleRate !== RNNOISE_SAMPLE_RATE;
    const input = needsResample
      ? await resample(samples, sampleRate, RNNOISE_SAMPLE_RATE)
      : Float32Array.from(samples);

    const id = this.nextId++;
    const processed = await new Promise<Float32Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: DenoiseRequest = {
        type: 'process',
        id,
        samples: input,
        sampleRate: RNNOISE_SAMPLE_RATE,
      };
      worker.postMessage(request, [input.buffer]);
    });

    if (this.lastStats) this.lastStats.resampled = needsResample;

    return needsResample
      ? await resample(processed, RNNOISE_SAMPLE_RATE, sampleRate)
      : processed;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.pending.clear();
  }
}

/**
 * Resamples via OfflineAudioContext — the browser's own resampler, which is
 * better than anything worth hand-rolling here. This is why resampling lives on
 * the main thread: OfflineAudioContext is not available inside a worker.
 */
export async function resample(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Promise<Float32Array> {
  if (fromRate === toRate) return Float32Array.from(samples);

  const sourceCtx = new OfflineAudioContext(1, samples.length, fromRate);
  const buffer = sourceCtx.createBuffer(1, samples.length, fromRate);
  buffer.getChannelData(0).set(samples);

  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const targetCtx = new OfflineAudioContext(1, length, toRate);
  const source = targetCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(targetCtx.destination);
  source.start();

  const rendered = await targetCtx.startRendering();
  return rendered.getChannelData(0).slice();
}

/**
 * Keeps the raw and processed versions side by side so the UI can A/B them
 * before the user commits (§6.4). Nothing is destructive until `commit()`.
 */
export class DenoisePreview {
  readonly raw: Float32Array;
  readonly processed: Float32Array;
  readonly sampleRate: number;
  readonly stats: DenoiseStats | null;

  constructor(
    raw: Float32Array,
    processed: Float32Array,
    sampleRate: number,
    stats: DenoiseStats | null,
  ) {
    this.raw = raw;
    this.processed = processed;
    this.sampleRate = sampleRate;
    this.stats = stats;
  }

  commit(accept: boolean): Float32Array {
    return accept ? this.processed : this.raw;
  }
}
