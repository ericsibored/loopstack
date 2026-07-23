/**
 * AlignmentEngine (§4.4) — latency calibration, auto-align suggestions, and
 * grid snapping.
 *
 * Everything here produces a *suggestion*. Nothing in this module mutates a
 * track or applies an offset; callers decide. That is a product requirement
 * (auto-align is never silently applied) as much as an architectural one.
 */

import { DEFAULT_ALIGN_SEARCH_MS } from './constants';
import { findOnsetIndex, generateClick } from './onsetDetection';
import type { AlignRequest, AlignResponse } from '../workers/align.worker';

export interface AlignSuggestion {
  /** Milliseconds to add to the candidate track's `offsetMs` to align it. */
  suggestedOffsetMs: number;
  /** Normalized correlation, in [-1, 1]. Low values mean "don't trust this". */
  confidence: number;
  /** Wall-clock time the correlation took — useful for the Phase 0 spike. */
  elapsedMs: number;
}

export interface CalibrationResult {
  /** Measured output→input round-trip delay. */
  inputLatencyOffsetMs: number;
  /** False if no click was detected; the caller should not trust the number. */
  detected: boolean;
  /** Raw capture, so a failed calibration can be inspected rather than guessed at. */
  capture: Float32Array;
  sampleRate: number;
}

export class AlignmentEngine {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, (r: AlignResponse) => void>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/align.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (event: MessageEvent<AlignResponse>) => {
        const resolve = this.pending.get(event.data.id);
        if (resolve) {
          this.pending.delete(event.data.id);
          resolve(event.data);
        }
      };
    }
    return this.worker;
  }

  /**
   * Cross-correlates `candidate` against `reference` and returns the offset
   * that would align them. Runs off the main thread (§6.3).
   */
  async suggestAlignment(
    reference: Float32Array,
    candidate: Float32Array,
    sampleRate: number,
    maxLagMs = DEFAULT_ALIGN_SEARCH_MS,
  ): Promise<AlignSuggestion> {
    const worker = this.ensureWorker();
    const id = this.nextRequestId++;

    // Copy before transferring: the caller's arrays are usually AudioBuffer
    // channel data that must stay usable after this call.
    const refCopy = Float32Array.from(reference);
    const candCopy = Float32Array.from(candidate);

    const request: AlignRequest = {
      id,
      reference: refCopy,
      candidate: candCopy,
      sampleRate,
      maxLagMs,
    };

    const response = await new Promise<AlignResponse>((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage(request, [refCopy.buffer, candCopy.buffer]);
    });

    return {
      // A positive lag means the candidate arrives late, so it must be nudged
      // earlier — hence the sign flip.
      suggestedOffsetMs: -response.lagMs,
      confidence: response.score,
      elapsedMs: response.elapsedMs,
    };
  }

  /**
   * Measures round-trip latency (§6.2): play a click, record it, and see how
   * much later it came back.
   *
   * `playClick` is injected so this stays testable and so the caller controls
   * routing (the click must go through the real output path to be meaningful).
   */
  static computeCalibration(
    capture: Float32Array,
    sampleRate: number,
    captureStartTime: number,
    clickScheduledTime: number,
  ): CalibrationResult {
    const onsetIndex = findOnsetIndex(capture);
    if (onsetIndex < 0) {
      return { inputLatencyOffsetMs: 0, detected: false, capture, sampleRate };
    }
    const onsetTime = captureStartTime + onsetIndex / sampleRate;
    const roundTripSec = onsetTime - clickScheduledTime;
    return {
      inputLatencyOffsetMs: roundTripSec * 1000,
      detected: true,
      capture,
      sampleRate,
    };
  }

  /** Rounds an offset to the nearest beat for snap-to-grid (§4.4). */
  static snapToGrid(offsetMs: number, bpm: number, subdivision = 1): number {
    const beatMs = 60000 / bpm / subdivision;
    return Math.round(offsetMs / beatMs) * beatMs;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}

export { generateClick };
