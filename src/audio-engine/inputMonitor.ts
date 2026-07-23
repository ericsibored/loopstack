/**
 * Live input level metering, so mic settings can be checked *before* committing
 * a take rather than discovered afterwards.
 *
 * Pure measurement — it reads the analyser and returns numbers. No React, no
 * canvas, no rAF: the caller decides how often to sample and how to draw.
 */

/** Anything at or above this is treated as clipped. */
const CLIP_THRESHOLD = 0.999;

/** How fast the peak-hold falls, in dB per second. */
const PEAK_FALL_DB_PER_SEC = 20;

export interface InputLevel {
  /** Instantaneous peak in dBFS; -Infinity when silent. */
  peakDb: number;
  /** RMS in dBFS — closer to perceived loudness than peak. */
  rmsDb: number;
  /** Slowly falling peak-hold, so brief transients stay readable. */
  peakHoldDb: number;
  /** True if the signal hit full scale since the last reset. */
  clipped: boolean;
}

export class InputMonitor {
  // Explicitly backed by ArrayBuffer: `getFloatTimeDomainData` will not accept
  // a view that might sit on a SharedArrayBuffer.
  private readonly buffer: Float32Array<ArrayBuffer>;
  private analyser: AnalyserNode | null = null;

  private peakHoldDb = -Infinity;
  private lastSampleTime: number | null = null;
  private clipped = false;

  constructor(fftSize = 2048) {
    this.buffer = new Float32Array(fftSize);
  }

  attach(analyser: AnalyserNode | null): void {
    this.analyser = analyser;
    this.reset();
  }

  get isAttached(): boolean {
    return this.analyser !== null;
  }

  reset(): void {
    this.peakHoldDb = -Infinity;
    this.clipped = false;
    this.lastSampleTime = null;
  }

  /**
   * Samples the current level. `nowMs` drives the peak-hold decay and is passed
   * in rather than read from a clock so this stays deterministic in tests.
   */
  sample(nowMs: number): InputLevel {
    if (!this.analyser) {
      return { peakDb: -Infinity, rmsDb: -Infinity, peakHoldDb: -Infinity, clipped: false };
    }

    const data = this.buffer.subarray(0, this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);

    let peak = 0;
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      sumSquares += data[i] * data[i];
    }

    if (peak >= CLIP_THRESHOLD) this.clipped = true;

    const peakDb = toDb(peak);
    const rmsDb = toDb(Math.sqrt(sumSquares / data.length));

    // Decay the hold toward the current peak rather than snapping to it, so a
    // single transient stays visible long enough to read.
    if (this.lastSampleTime !== null) {
      const elapsedSec = Math.max(0, (nowMs - this.lastSampleTime) / 1000);
      if (Number.isFinite(this.peakHoldDb)) {
        this.peakHoldDb -= PEAK_FALL_DB_PER_SEC * elapsedSec;
      }
    }
    this.lastSampleTime = nowMs;
    if (peakDb > this.peakHoldDb) this.peakHoldDb = peakDb;

    return { peakDb, rmsDb, peakHoldDb: this.peakHoldDb, clipped: this.clipped };
  }
}

export function toDb(amplitude: number): number {
  return amplitude <= 0 ? -Infinity : 20 * Math.log10(amplitude);
}

/**
 * Maps dBFS to a 0-1 meter position over a 60 dB window.
 *
 * Linear amplitude would cram everything usable into the top sliver of the
 * meter; a dB scale puts the range people actually record in across the middle.
 */
export function dbToMeterPosition(db: number, floorDb = -60): number {
  if (!Number.isFinite(db)) return 0;
  if (db >= 0) return 1;
  if (db <= floorDb) return 0;
  return 1 - db / floorDb;
}

export type LevelVerdict = 'silent' | 'too-quiet' | 'good' | 'hot' | 'clipping';

/**
 * Turns a level into advice. The whole point of this screen is answering "is
 * this set up right", and a bare number does not answer it for most people.
 */
export function judgeLevel(peakHoldDb: number, clipped: boolean): LevelVerdict {
  if (clipped) return 'clipping';
  if (!Number.isFinite(peakHoldDb) || peakHoldDb < -55) return 'silent';
  if (peakHoldDb < -30) return 'too-quiet';
  if (peakHoldDb > -3) return 'hot';
  return 'good';
}
