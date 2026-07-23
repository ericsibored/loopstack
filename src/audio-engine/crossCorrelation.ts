/**
 * Cross-correlation for auto-align (§6.3). Pure functions, no Web Audio — this
 * is the piece unit tests can actually verify, so it deliberately knows nothing
 * about AudioBuffers or workers.
 *
 * Correlation is *normalized* (divided by the energy of the overlapping region)
 * rather than raw. A raw dot product biases toward whichever lag happens to
 * line up the loudest samples, which for musical material is frequently the
 * wrong beat.
 */

export interface LagSearchOptions {
  /** Widest lag considered, in samples, searched symmetrically as ±maxLag. */
  maxLagSamples: number;
  /**
   * Coarse pass downsample factor. The search runs on decimated signals, then
   * refines at full rate near the winner. 1 disables the coarse pass.
   */
  downsampleFactor?: number;
  /**
   * Cap on how much of each signal is compared. Correlating a 30s loop end to
   * end is wasteful; a few seconds is plenty to find the offset.
   */
  analysisWindowSamples?: number;
}

export interface LagResult {
  /**
   * Lag in samples. Positive means `candidate` lags `reference` — i.e. the
   * candidate's content occurs later and must be nudged earlier to align.
   */
  lagSamples: number;
  /** Normalized correlation at the winning lag, in [-1, 1]. */
  score: number;
}

const DEFAULT_DOWNSAMPLE = 8;
const DEFAULT_ANALYSIS_WINDOW = 48000 * 4; // ~4s at 48 kHz

/** Box-average decimation. Doubles as the anti-alias filter for the coarse pass. */
export function downsample(input: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return input;
  const outLength = Math.floor(input.length / factor);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) sum += input[base + j];
    out[i] = sum / factor;
  }
  return out;
}

/**
 * Normalized correlation of `a` against `b` shifted by `lag`, over the region
 * where the two actually overlap.
 */
export function correlationAtLag(a: Float32Array, b: Float32Array, lag: number): number {
  const start = Math.max(0, -lag);
  const end = Math.min(a.length, b.length - lag);
  if (end <= start) return 0;

  let dot = 0;
  let energyA = 0;
  let energyB = 0;
  for (let i = start; i < end; i++) {
    const av = a[i];
    const bv = b[i + lag];
    dot += av * bv;
    energyA += av * av;
    energyB += bv * bv;
  }

  const denom = Math.sqrt(energyA * energyB);
  return denom === 0 ? 0 : dot / denom;
}

/** Exhaustive scan over an inclusive lag range. */
export function searchLagRange(
  a: Float32Array,
  b: Float32Array,
  minLag: number,
  maxLag: number,
): LagResult {
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = correlationAtLag(a, b, lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return { lagSamples: bestLag, score: bestScore === -Infinity ? 0 : bestScore };
}

/**
 * Finds the lag that best aligns `candidate` to `reference`, using a coarse
 * decimated scan followed by a full-rate refinement around the coarse winner.
 */
export function findBestLag(
  reference: Float32Array,
  candidate: Float32Array,
  options: LagSearchOptions,
): LagResult {
  const {
    maxLagSamples,
    downsampleFactor = DEFAULT_DOWNSAMPLE,
    analysisWindowSamples = DEFAULT_ANALYSIS_WINDOW,
  } = options;

  const window = Math.min(
    analysisWindowSamples,
    Math.max(reference.length, candidate.length),
  );
  const ref = reference.subarray(0, Math.min(window, reference.length));
  // The candidate needs headroom past the window to be shifted into it.
  const cand = candidate.subarray(0, Math.min(window + maxLagSamples, candidate.length));

  // A coarse pass only pays off if decimation leaves enough resolution to be
  // meaningful; for short searches, scan at full rate directly.
  if (downsampleFactor <= 1 || maxLagSamples / downsampleFactor < 4) {
    return searchLagRange(ref, cand, -maxLagSamples, maxLagSamples);
  }

  const coarseRef = downsample(ref, downsampleFactor);
  const coarseCand = downsample(cand, downsampleFactor);
  const coarseMaxLag = Math.floor(maxLagSamples / downsampleFactor);
  const coarse = searchLagRange(coarseRef, coarseCand, -coarseMaxLag, coarseMaxLag);

  // Refine within one coarse step either side, which is where the true peak
  // must lie if the coarse pass found the right neighbourhood.
  const center = coarse.lagSamples * downsampleFactor;
  const lo = Math.max(-maxLagSamples, center - downsampleFactor);
  const hi = Math.min(maxLagSamples, center + downsampleFactor);
  return searchLagRange(ref, cand, lo, hi);
}

export function samplesToMs(samples: number, sampleRate: number): number {
  return (samples / sampleRate) * 1000;
}

export function msToSamples(ms: number, sampleRate: number): number {
  return Math.round((ms / 1000) * sampleRate);
}
