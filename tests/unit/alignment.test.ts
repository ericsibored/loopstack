import { describe, expect, it } from 'vitest';
import { AlignmentEngine } from '../../src/audio-engine/alignmentEngine';
import { findOnsetIndex, generateClick, rmsEnvelope } from '../../src/audio-engine/onsetDetection';
import { sliceLoop } from '../../src/audio-engine/recordingManager';
import type { CaptureResult } from '../../src/audio-engine/types';

const SAMPLE_RATE = 48000;

function silenceThen(clickAt: number, totalSamples: number, noise = 0.001): Float32Array {
  const out = new Float32Array(totalSamples);
  let state = 42;
  for (let i = 0; i < totalSamples; i++) {
    state = (state * 1664525 + 1013904223) % 4294967296;
    out[i] = ((state / 4294967296) * 2 - 1) * noise;
  }
  const click = generateClick(SAMPLE_RATE);
  for (let i = 0; i < click.length && clickAt + i < totalSamples; i++) {
    out[clickAt + i] += click[i];
  }
  return out;
}

describe('onset detection', () => {
  it('finds the click within one analysis window', () => {
    const clickAt = 4800;
    const signal = silenceThen(clickAt, SAMPLE_RATE);
    const onset = findOnsetIndex(signal);
    expect(onset).toBeGreaterThanOrEqual(0);
    // Sample-resolution, not window-resolution: calibration accuracy depends
    // on this being tight, since ~1ms of error is ~1ms of misalignment.
    expect(Math.abs(onset - clickAt)).toBeLessThanOrEqual(8);
  });

  it('returns -1 on a silent capture rather than guessing', () => {
    expect(findOnsetIndex(new Float32Array(SAMPLE_RATE))).toBe(-1);
  });

  it('does not trigger on steady low-level room noise', () => {
    let state = 5;
    const noise = new Float32Array(SAMPLE_RATE);
    for (let i = 0; i < noise.length; i++) {
      state = (state * 1664525 + 1013904223) % 4294967296;
      noise[i] = ((state / 4294967296) * 2 - 1) * 0.002;
    }
    expect(findOnsetIndex(noise)).toBe(-1);
  });

  it('produces one envelope value per window', () => {
    expect(rmsEnvelope(new Float32Array(1000), 100).length).toBe(10);
  });
});

describe('AlignmentEngine.computeCalibration', () => {
  it('measures round-trip delay from the click onset', () => {
    // Capture starts at t=10.0; the click was scheduled for t=10.1 and lands
    // in the capture at 150ms — so the measured round trip is 50ms.
    const clickAt = Math.round(0.15 * SAMPLE_RATE);
    const capture = silenceThen(clickAt, SAMPLE_RATE);

    const result = AlignmentEngine.computeCalibration(capture, SAMPLE_RATE, 10.0, 10.1);

    expect(result.detected).toBe(true);
    expect(result.inputLatencyOffsetMs).toBeGreaterThan(49.8);
    expect(result.inputLatencyOffsetMs).toBeLessThan(50.2);
  });

  it('flags an undetected click instead of returning a bogus offset', () => {
    const result = AlignmentEngine.computeCalibration(
      new Float32Array(SAMPLE_RATE),
      SAMPLE_RATE,
      0,
      0,
    );
    expect(result.detected).toBe(false);
    expect(result.inputLatencyOffsetMs).toBe(0);
  });
});

describe('AlignmentEngine.snapToGrid', () => {
  it('rounds to the nearest beat', () => {
    // 120 BPM → 500ms per beat.
    expect(AlignmentEngine.snapToGrid(260, 120)).toBe(500);
    expect(AlignmentEngine.snapToGrid(240, 120)).toBe(0);
    expect(AlignmentEngine.snapToGrid(-260, 120)).toBe(-500);
  });

  it('honours subdivisions', () => {
    // 120 BPM, 16th notes → 125ms grid.
    expect(AlignmentEngine.snapToGrid(130, 120, 4)).toBe(125);
  });
});

describe('sliceLoop', () => {
  const capture = (startTime: number, length: number): CaptureResult => {
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i++) samples[i] = i;
    return { samples, sampleRate: SAMPLE_RATE, startTime };
  };

  it('cuts the window that corresponds to the loop boundary', () => {
    // Capture began at t=5; the boundary is at t=6, so the slice starts one
    // second (48000 samples) into the capture.
    const result = sliceLoop(capture(5, SAMPLE_RATE * 3), 6, 1);
    expect(result.length).toBe(SAMPLE_RATE);
    expect(result[0]).toBe(SAMPLE_RATE);
  });

  it('shifts the window later by the measured input latency', () => {
    // 100ms of latency means the audio for loop position 0 arrived 100ms late,
    // so the cut moves 4800 samples later.
    const result = sliceLoop(capture(5, SAMPLE_RATE * 3), 6, 1, 100);
    expect(result[0]).toBe(SAMPLE_RATE + 4800);
  });

  it('zero-fills rather than shifting when the capture starts too late', () => {
    // Boundary precedes capture start by 0.5s — the first half must be silence,
    // with the real audio still landing at the correct loop position.
    const result = sliceLoop(capture(5, SAMPLE_RATE * 3), 4.5, 1);
    const half = SAMPLE_RATE / 2;
    expect(result[0]).toBe(0);
    expect(result[half - 1]).toBe(0);
    expect(result[half]).toBe(0);
    expect(result[half + 10]).toBe(10);
  });

  it('zero-fills past the end of a short capture', () => {
    const result = sliceLoop(capture(5, SAMPLE_RATE), 5, 2);
    expect(result.length).toBe(SAMPLE_RATE * 2);
    expect(result[SAMPLE_RATE - 1]).toBe(SAMPLE_RATE - 1);
    expect(result[SAMPLE_RATE]).toBe(0);
  });
});
