/**
 * De-noise worker wrapping rnnoise (WASM).
 *
 * The wasm binary is fetched here and handed to the module as `wasmBinary`
 * rather than letting emscripten locate it. The glue detects its environment
 * via `window`/`importScripts`, and inside a *module* worker neither exists, so
 * its own loading path does not fire. Supplying the bytes bypasses that
 * detection entirely.
 *
 * rnnoise is fixed at 48 kHz and 480-sample frames. Resampling is the caller's
 * job (see denoiseProcessor.ts) because OfflineAudioContext — the good way to
 * resample — is not available in a worker.
 */

import createRNNWasmModule from '@jitsi/rnnoise-wasm/dist/rnnoise';
import { RNNOISE_FRAME_SIZE, RNNOISE_SAMPLE_RATE } from '../audio-engine/constants';

/** rnnoise expects samples scaled to int16 range, not [-1, 1]. */
const INT16_SCALE = 32768;

export interface DenoiseInitRequest {
  type: 'init';
  wasmUrl: string;
}

export interface DenoiseProcessRequest {
  type: 'process';
  id: number;
  samples: Float32Array;
  sampleRate: number;
}

export type DenoiseRequest = DenoiseInitRequest | DenoiseProcessRequest;

export interface DenoiseReadyResponse {
  type: 'ready';
  loadMs: number;
}

export interface DenoiseResultResponse {
  type: 'result';
  id: number;
  samples: Float32Array;
  /** Mean rnnoise voice-activity probability — a rough "did it find speech" signal. */
  meanVad: number;
  elapsedMs: number;
}

export interface DenoiseErrorResponse {
  type: 'error';
  id?: number;
  message: string;
}

export type DenoiseResponse =
  | DenoiseReadyResponse
  | DenoiseResultResponse
  | DenoiseErrorResponse;

interface RNNoiseModule {
  _rnnoise_create(model?: number): number;
  _rnnoise_destroy(state: number): void;
  _rnnoise_process_frame(state: number, out: number, input: number): number;
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAPF32: Float32Array;
}

/**
 * The project compiles against the DOM lib, so `self` is typed as a Window.
 * Adding the WebWorker lib instead would clash with DOM across the rest of the
 * app, so the worker narrows its own global here.
 */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<DenoiseRequest>) => void) | null;
  postMessage(message: DenoiseResponse, transfer?: Transferable[]): void;
};

let modulePromise: Promise<RNNoiseModule> | null = null;

async function loadModule(wasmUrl: string): Promise<RNNoiseModule> {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Failed to fetch rnnoise.wasm: ${response.status}`);
  const wasmBinary = await response.arrayBuffer();
  return (await createRNNWasmModule({ wasmBinary })) as RNNoiseModule;
}

function denoise(mod: RNNoiseModule, samples: Float32Array): { out: Float32Array; meanVad: number } {
  const state = mod._rnnoise_create(0);
  const ptr = mod._malloc(RNNOISE_FRAME_SIZE * 4);
  const out = new Float32Array(samples.length);

  let vadSum = 0;
  let frames = 0;

  try {
    for (let start = 0; start < samples.length; start += RNNOISE_FRAME_SIZE) {
      const heap = mod.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + RNNOISE_FRAME_SIZE);

      // The final partial frame is zero-padded; rnnoise has no short-frame mode.
      const available = Math.min(RNNOISE_FRAME_SIZE, samples.length - start);
      for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
        heap[i] = i < available ? samples[start + i] * INT16_SCALE : 0;
      }

      vadSum += mod._rnnoise_process_frame(state, ptr, ptr);
      frames++;

      // Re-read the heap view: a wasm memory growth during processing would
      // have detached the earlier one.
      const result = mod.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + RNNOISE_FRAME_SIZE);
      for (let i = 0; i < available; i++) {
        out[start + i] = result[i] / INT16_SCALE;
      }
    }
  } finally {
    mod._free(ptr);
    mod._rnnoise_destroy(state);
  }

  return { out, meanVad: frames === 0 ? 0 : vadSum / frames };
}

ctx.onmessage = async (event) => {
  const request = event.data;

  try {
    if (request.type === 'init') {
      const started = performance.now();
      modulePromise = loadModule(request.wasmUrl);
      await modulePromise;
      const ready: DenoiseReadyResponse = { type: 'ready', loadMs: performance.now() - started };
      ctx.postMessage(ready);
      return;
    }

    if (!modulePromise) throw new Error('Worker not initialized');
    if (request.sampleRate !== RNNOISE_SAMPLE_RATE) {
      throw new Error(
        `rnnoise requires ${RNNOISE_SAMPLE_RATE} Hz, got ${request.sampleRate} — resample before sending`,
      );
    }

    const mod = await modulePromise;
    const started = performance.now();
    const { out, meanVad } = denoise(mod, request.samples);

    const result: DenoiseResultResponse = {
      type: 'result',
      id: request.id,
      samples: out,
      meanVad,
      elapsedMs: performance.now() - started,
    };
    ctx.postMessage(result, [out.buffer as ArrayBuffer]);
  } catch (error) {
    const message: DenoiseErrorResponse = {
      type: 'error',
      id: request.type === 'process' ? request.id : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(message);
  }
};
