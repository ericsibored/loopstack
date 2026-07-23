import { describe, expect, it } from 'vitest';
import {
  correlationAtLag,
  downsample,
  findBestLag,
  msToSamples,
  samplesToMs,
} from '../../src/audio-engine/crossCorrelation';

const SAMPLE_RATE = 48000;

/** A rhythmic pattern with sharp transients — what correlation locks onto. */
function makePattern(length: number, hits = [0, 0.25, 0.5, 0.75]): Float32Array {
  const out = new Float32Array(length);
  for (const position of hits) {
    const at = Math.round(position * length);
    for (let i = 0; i < 200 && at + i < length; i++) {
      out[at + i] = Math.sin((2 * Math.PI * 800 * i) / SAMPLE_RATE) * Math.exp(-i / 400);
    }
  }
  return out;
}

function shift(input: Float32Array, by: number): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const src = i - by;
    if (src >= 0 && src < input.length) out[i] = input[src];
  }
  return out;
}

function withNoise(input: Float32Array, amplitude: number, seed = 1): Float32Array {
  // Deterministic LCG — a flaky alignment test would be worse than no test.
  let state = seed;
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    out[i] = input[i] + ((state / 4294967296) * 2 - 1) * amplitude;
  }
  return out;
}

describe('correlationAtLag', () => {
  it('is 1 for a signal against itself at lag 0', () => {
    const signal = makePattern(4800);
    expect(correlationAtLag(signal, signal, 0)).toBeCloseTo(1, 6);
  });

  it('is -1 for an inverted signal', () => {
    const signal = makePattern(4800);
    const inverted = signal.map((v) => -v);
    expect(correlationAtLag(signal, inverted, 0)).toBeCloseTo(-1, 6);
  });

  it('returns 0 when the shifted regions do not overlap', () => {
    const a = new Float32Array(100).fill(1);
    const b = new Float32Array(100).fill(1);
    expect(correlationAtLag(a, b, 500)).toBe(0);
  });
});

describe('downsample', () => {
  it('averages within each block', () => {
    const input = Float32Array.from([0, 2, 4, 6, 8, 10]);
    expect(Array.from(downsample(input, 2))).toEqual([1, 5, 9]);
  });

  it('is a no-op for factor 1', () => {
    const input = Float32Array.from([1, 2, 3]);
    expect(downsample(input, 1)).toBe(input);
  });
});

describe('findBestLag', () => {
  it('recovers a known positive shift to the sample', () => {
    const reference = makePattern(SAMPLE_RATE * 2);
    const trueShift = msToSamples(37, SAMPLE_RATE);
    const candidate = shift(reference, trueShift);

    const result = findBestLag(reference, candidate, {
      maxLagSamples: msToSamples(200, SAMPLE_RATE),
    });

    expect(Math.abs(result.lagSamples - trueShift)).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('recovers a negative shift', () => {
    const reference = makePattern(SAMPLE_RATE * 2);
    const trueShift = -msToSamples(52, SAMPLE_RATE);
    const candidate = shift(reference, trueShift);

    const result = findBestLag(reference, candidate, {
      maxLagSamples: msToSamples(200, SAMPLE_RATE),
    });

    expect(Math.abs(result.lagSamples - trueShift)).toBeLessThanOrEqual(1);
  });

  it('stays accurate with noise on the candidate', () => {
    const reference = makePattern(SAMPLE_RATE * 2);
    const trueShift = msToSamples(23, SAMPLE_RATE);
    const candidate = withNoise(shift(reference, trueShift), 0.05);

    const result = findBestLag(reference, candidate, {
      maxLagSamples: msToSamples(200, SAMPLE_RATE),
    });

    expect(Math.abs(samplesToMs(result.lagSamples, SAMPLE_RATE) - 23)).toBeLessThan(1);
  });

  it('agrees with a full-rate exhaustive scan', () => {
    const reference = makePattern(SAMPLE_RATE);
    const trueShift = msToSamples(15, SAMPLE_RATE);
    const candidate = shift(reference, trueShift);
    const maxLagSamples = msToSamples(100, SAMPLE_RATE);

    const coarse = findBestLag(reference, candidate, { maxLagSamples });
    const exact = findBestLag(reference, candidate, { maxLagSamples, downsampleFactor: 1 });

    expect(Math.abs(coarse.lagSamples - exact.lagSamples)).toBeLessThanOrEqual(1);
  });

  it('reports low confidence for uncorrelated signals', () => {
    const reference = withNoise(new Float32Array(SAMPLE_RATE), 1, 7);
    const candidate = withNoise(new Float32Array(SAMPLE_RATE), 1, 99);

    const result = findBestLag(reference, candidate, {
      maxLagSamples: msToSamples(200, SAMPLE_RATE),
    });

    // Noise-vs-noise always has *some* best lag; the point is that its score
    // is far from 1, which is what the UI gates the suggestion on.
    expect(result.score).toBeLessThan(0.3);
  });

  it('cannot find a shift outside the search window', () => {
    const reference = makePattern(SAMPLE_RATE * 2);
    const candidate = shift(reference, msToSamples(300, SAMPLE_RATE));

    const result = findBestLag(reference, candidate, {
      maxLagSamples: msToSamples(50, SAMPLE_RATE),
    });

    expect(Math.abs(samplesToMs(result.lagSamples, SAMPLE_RATE))).toBeLessThanOrEqual(50);
  });
});

describe('unit conversion', () => {
  it('round-trips ms and samples', () => {
    expect(msToSamples(1000, 48000)).toBe(48000);
    expect(samplesToMs(48000, 48000)).toBe(1000);
    expect(samplesToMs(msToSamples(37, 44100), 44100)).toBeCloseTo(37, 1);
  });
});
