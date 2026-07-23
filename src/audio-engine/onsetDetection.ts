/**
 * Onset detection for latency calibration (§6.2). Pure functions.
 *
 * The calibration signal is a short click, so we don't need anything clever —
 * an energy envelope plus a threshold relative to the noise floor finds the
 * arrival reliably and is easy to reason about when a measurement looks wrong.
 */

export interface OnsetOptions {
  /** RMS window length in samples. */
  windowSamples?: number;
  /** How many times above the noise floor counts as an onset. */
  thresholdRatio?: number;
  /** Absolute floor, so a silent recording can't trigger on rounding noise. */
  minAmplitude?: number;
}

const DEFAULT_WINDOW = 64;
const DEFAULT_THRESHOLD_RATIO = 8;
const DEFAULT_MIN_AMPLITUDE = 0.01;

/**
 * Index of the first sample where energy rises decisively above the noise
 * floor, or -1 if nothing does.
 *
 * The noise floor is measured from the quietest part of the signal rather than
 * assumed, because room noise varies enormously between the environments this
 * app will actually run in.
 */
export function findOnsetIndex(samples: Float32Array, options: OnsetOptions = {}): number {
  const {
    windowSamples = DEFAULT_WINDOW,
    thresholdRatio = DEFAULT_THRESHOLD_RATIO,
    minAmplitude = DEFAULT_MIN_AMPLITUDE,
  } = options;

  if (samples.length < windowSamples) return -1;

  const envelope = rmsEnvelope(samples, windowSamples);
  if (envelope.length === 0) return -1;

  const floor = percentile(envelope, 0.1);
  const threshold = Math.max(floor * thresholdRatio, minAmplitude);

  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] >= threshold) {
      return refineOnset(samples, i * windowSamples, windowSamples, threshold);
    }
  }
  return -1;
}

/**
 * Narrows a window-resolution hit down to a sample.
 *
 * Without this, calibration is quantized to the envelope window — 64 samples is
 * ~1.3ms at 48 kHz, which is a meaningful fraction of the latency being
 * measured. Scanning back from the start of the triggering window catches the
 * attack even when it began just before the window boundary.
 */
function refineOnset(
  samples: Float32Array,
  windowStart: number,
  windowSamples: number,
  threshold: number,
): number {
  const from = Math.max(0, windowStart - windowSamples);
  const to = Math.min(samples.length, windowStart + windowSamples);
  for (let i = from; i < to; i++) {
    if (Math.abs(samples[i]) >= threshold) return i;
  }
  return windowStart;
}

/** Non-overlapping RMS windows. One value per window, not per sample. */
export function rmsEnvelope(samples: Float32Array, windowSamples: number): Float32Array {
  const count = Math.floor(samples.length / windowSamples);
  const out = new Float32Array(count);
  for (let w = 0; w < count; w++) {
    let sum = 0;
    const base = w * windowSamples;
    for (let i = 0; i < windowSamples; i++) {
      const v = samples[base + i];
      sum += v * v;
    }
    out[w] = Math.sqrt(sum / windowSamples);
  }
  return out;
}

function percentile(values: Float32Array, p: number): number {
  const sorted = Float32Array.from(values).sort();
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index];
}

/**
 * A short calibration click: a burst of decaying noise-free tone. Broadband
 * enough to have a sharp envelope, short enough that its onset is unambiguous.
 */
export function generateClick(sampleRate: number, durationMs = 20, frequency = 2000): Float32Array {
  const length = Math.round((durationMs / 1000) * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    const decay = Math.exp(-t * 250);
    out[i] = Math.sin(2 * Math.PI * frequency * t) * decay;
  }
  return out;
}
