/**
 * Auto-align worker. Kept separate from the de-noise worker: the two have very
 * different lifetimes (align is a short burst, de-noise holds a WASM instance),
 * and combining them would mean loading the rnnoise binary just to run a
 * correlation.
 */

import { findBestLag, msToSamples, samplesToMs } from '../audio-engine/crossCorrelation';

export interface AlignRequest {
  id: number;
  reference: Float32Array;
  candidate: Float32Array;
  sampleRate: number;
  maxLagMs: number;
  downsampleFactor?: number;
  analysisWindowMs?: number;
}

export interface AlignResponse {
  id: number;
  lagSamples: number;
  lagMs: number;
  score: number;
  elapsedMs: number;
}

/** See denoise.worker.ts — `self` is DOM-typed, so the worker narrows it here. */
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<AlignRequest>) => void) | null;
  postMessage(message: AlignResponse): void;
};

ctx.onmessage = (event) => {
  const req = event.data;
  const started = performance.now();

  const result = findBestLag(req.reference, req.candidate, {
    maxLagSamples: msToSamples(req.maxLagMs, req.sampleRate),
    downsampleFactor: req.downsampleFactor,
    analysisWindowSamples: req.analysisWindowMs
      ? msToSamples(req.analysisWindowMs, req.sampleRate)
      : undefined,
  });

  const response: AlignResponse = {
    id: req.id,
    lagSamples: result.lagSamples,
    lagMs: samplesToMs(result.lagSamples, req.sampleRate),
    score: result.score,
    elapsedMs: performance.now() - started,
  };
  ctx.postMessage(response);
};
