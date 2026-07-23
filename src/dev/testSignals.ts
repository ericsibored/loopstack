/**
 * Synthetic signals for the Phase 0 spikes, so each one can be exercised
 * without a mic or a recorded take.
 */

/** A short percussive blip at `frequency`, decaying over `decayMs`. */
function blip(
  out: Float32Array,
  sampleRate: number,
  atSample: number,
  frequency: number,
  decayMs: number,
  amplitude: number,
): void {
  const length = Math.round((decayMs / 1000) * sampleRate);
  for (let i = 0; i < length; i++) {
    const index = atSample + i;
    if (index >= out.length) break;
    const t = i / sampleRate;
    const envelope = Math.exp((-t * 1000) / decayMs) * amplitude;
    out[index] += Math.sin(2 * Math.PI * frequency * t) * envelope;
  }
}

/**
 * A one-bar rhythmic pattern. Four transients per loop gives cross-correlation
 * something unambiguous to lock onto, and makes a loop-boundary click audible
 * against the gaps between hits.
 */
export function makeRhythmLoop(
  sampleRate: number,
  loopLengthSec: number,
  rootFrequency = 220,
): Float32Array {
  const length = Math.round(loopLengthSec * sampleRate);
  const out = new Float32Array(length);
  const beats = 4;
  for (let b = 0; b < beats; b++) {
    const at = Math.round((b / beats) * length);
    blip(out, sampleRate, at, b === 0 ? rootFrequency : rootFrequency * 1.5, 120, b === 0 ? 0.6 : 0.35);
  }
  return out;
}

/** A sustained tone. Boundary discontinuities are most audible on these. */
export function makeToneLoop(
  sampleRate: number,
  loopLengthSec: number,
  frequency = 220,
): Float32Array {
  const length = Math.round(loopLengthSec * sampleRate);
  const out = new Float32Array(length);
  // Round the frequency so a whole number of cycles fits the loop — otherwise
  // the discontinuity we hear is the signal's fault, not the scheduler's.
  const cycles = Math.max(1, Math.round(frequency * loopLengthSec));
  const adjusted = cycles / loopLengthSec;
  for (let i = 0; i < length; i++) {
    out[i] = Math.sin(2 * Math.PI * adjusted * (i / sampleRate)) * 0.3;
  }
  return out;
}

/** Shifts a signal by `shiftSamples` (positive = later), zero-filling the gap. */
export function shiftSignal(input: Float32Array, shiftSamples: number): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const src = i - shiftSamples;
    if (src >= 0 && src < input.length) out[i] = input[src];
  }
  return out;
}

/** Adds white noise at the given amplitude. Used to give the de-noiser work. */
export function addNoise(input: Float32Array, amplitude: number): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] + (Math.random() * 2 - 1) * amplitude;
  }
  return out;
}

/** Peak amplitude, for before/after readouts. */
export function peak(samples: Float32Array): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > max) max = v;
  }
  return max;
}

/** RMS in dBFS. The honest measure for "did de-noise actually remove anything". */
export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms === 0 ? -Infinity : 20 * Math.log10(rms);
}
