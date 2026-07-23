import { describe, expect, it } from 'vitest';
import {
  InputMonitor,
  dbToMeterPosition,
  judgeLevel,
  toDb,
} from '../../src/audio-engine/inputMonitor';

/** Stands in for an AnalyserNode fed a constant amplitude. */
function fakeAnalyser(amplitude: number, fftSize = 256) {
  return {
    fftSize,
    getFloatTimeDomainData(target: Float32Array) {
      for (let i = 0; i < target.length; i++) {
        // Alternate sign so RMS and peak differ meaningfully.
        target[i] = i % 2 === 0 ? amplitude : -amplitude;
      }
    },
  } as unknown as AnalyserNode;
}

/**
 * Like `fakeAnalyser`, but the level can change without re-attaching — which
 * matters because `attach()` deliberately resets the peak hold.
 */
function mutableAnalyser(initial: number, fftSize = 256) {
  const state = { amplitude: initial };
  const node = {
    fftSize,
    getFloatTimeDomainData(target: Float32Array) {
      for (let i = 0; i < target.length; i++) {
        target[i] = i % 2 === 0 ? state.amplitude : -state.amplitude;
      }
    },
  } as unknown as AnalyserNode;
  return { node, state };
}

describe('toDb', () => {
  it('maps full scale to 0 dB', () => {
    expect(toDb(1)).toBeCloseTo(0);
  });

  it('maps half amplitude to about -6 dB', () => {
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
  });

  it('maps silence to -Infinity, not a huge negative number', () => {
    expect(toDb(0)).toBe(-Infinity);
  });
});

describe('dbToMeterPosition', () => {
  it('puts full scale at the top and the floor at the bottom', () => {
    expect(dbToMeterPosition(0)).toBe(1);
    expect(dbToMeterPosition(-60)).toBe(0);
  });

  it('places -30 dB at the midpoint of a 60 dB window', () => {
    expect(dbToMeterPosition(-30)).toBeCloseTo(0.5);
  });

  it('clamps anything below the floor and above full scale', () => {
    expect(dbToMeterPosition(-200)).toBe(0);
    expect(dbToMeterPosition(6)).toBe(1);
    expect(dbToMeterPosition(-Infinity)).toBe(0);
  });
});

describe('judgeLevel', () => {
  it('calls out clipping above everything else', () => {
    // Clipped takes priority even at an otherwise healthy level.
    expect(judgeLevel(-12, true)).toBe('clipping');
  });

  it('recognises a healthy level', () => {
    expect(judgeLevel(-12, false)).toBe('good');
    expect(judgeLevel(-25, false)).toBe('good');
  });

  it('flags a level too quiet to record usefully', () => {
    expect(judgeLevel(-35, false)).toBe('too-quiet');
  });

  it('flags a level close enough to full scale to be risky', () => {
    expect(judgeLevel(-1, false)).toBe('hot');
  });

  it('reports silence separately from merely quiet', () => {
    expect(judgeLevel(-Infinity, false)).toBe('silent');
    expect(judgeLevel(-70, false)).toBe('silent');
  });
});

describe('InputMonitor', () => {
  it('returns silence when nothing is attached', () => {
    const monitor = new InputMonitor();
    const level = monitor.sample(0);
    expect(level.peakDb).toBe(-Infinity);
    expect(level.clipped).toBe(false);
  });

  it('measures peak and RMS of a steady signal', () => {
    const monitor = new InputMonitor();
    monitor.attach(fakeAnalyser(0.5));

    const level = monitor.sample(0);
    // A square-ish signal at 0.5 has peak == RMS.
    expect(level.peakDb).toBeCloseTo(-6.02, 1);
    expect(level.rmsDb).toBeCloseTo(-6.02, 1);
  });

  it('latches clipping once it happens', () => {
    const monitor = new InputMonitor();
    monitor.attach(fakeAnalyser(1));
    expect(monitor.sample(0).clipped).toBe(true);

    // A later quiet reading must not clear the warning — the user needs to see
    // that it happened, not just that it is not happening right now.
    monitor.attach(fakeAnalyser(1));
    const loud = monitor.sample(0);
    expect(loud.clipped).toBe(true);
  });

  it('clears the clip latch on reset', () => {
    const monitor = new InputMonitor();
    monitor.attach(fakeAnalyser(1));
    monitor.sample(0);
    monitor.reset();
    expect(monitor.sample(0).clipped).toBe(true); // still loud, so latches again

    monitor.attach(fakeAnalyser(0.1));
    monitor.reset();
    expect(monitor.sample(0).clipped).toBe(false);
  });

  it('holds the peak, then lets it fall over time', () => {
    const monitor = new InputMonitor();
    const { node, state } = mutableAnalyser(0.5);
    monitor.attach(node);
    const first = monitor.sample(0);
    expect(first.peakHoldDb).toBeCloseTo(-6.02, 1);

    // Signal drops, but the hold should still be above the new level shortly
    // after — that is what makes a transient readable.
    state.amplitude = 0.01;
    const after100ms = monitor.sample(100);
    expect(after100ms.peakDb).toBeLessThan(-30);
    expect(after100ms.peakHoldDb).toBeGreaterThan(-30);

    // Falls at 20 dB/sec, so a full second later it has dropped ~20 dB.
    const after1s = monitor.sample(1100);
    expect(after1s.peakHoldDb).toBeLessThan(after100ms.peakHoldDb - 15);
  });

  it('re-attaching resets the hold, since the graph was rebuilt', () => {
    const monitor = new InputMonitor();
    monitor.attach(fakeAnalyser(1));
    monitor.sample(0);

    monitor.attach(fakeAnalyser(0.01));
    const level = monitor.sample(0);
    expect(level.clipped).toBe(false);
    expect(level.peakHoldDb).toBeLessThan(-30);
  });
});
