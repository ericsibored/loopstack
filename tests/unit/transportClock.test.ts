import { describe, expect, it } from 'vitest';
import { TransportClock } from '../../src/audio-engine/transportClock';
import { ManualTicker } from '../../src/audio-engine/ticker';
import type { LoopBoundary } from '../../src/audio-engine/types';

/** Stands in for AudioContext: the clock only ever reads `currentTime`. */
class FakeClockSource {
  currentTime = 0;
  advance(seconds: number) {
    this.currentTime += seconds;
  }
}

function setup(scheduleAheadSec = 0.2) {
  const source = new FakeClockSource();
  const ticker = new ManualTicker();
  const clock = new TransportClock(source, { ticker, scheduleAheadSec });
  const boundaries: LoopBoundary[] = [];
  clock.onBoundary((b) => boundaries.push(b));
  return { source, ticker, clock, boundaries };
}

describe('TransportClock', () => {
  it('emits only boundaries inside the lookahead window', () => {
    const { clock, source, ticker, boundaries } = setup(0.2);
    clock.start(1, 0);

    // At t=0 with a 0.2s window, only the boundary at 0 qualifies.
    expect(boundaries.map((b) => b.time)).toEqual([0]);

    source.advance(0.9);
    ticker.tick();
    // Window now reaches 1.1, so the boundary at 1.0 is committed.
    expect(boundaries.map((b) => b.time)).toEqual([0, 1]);
  });

  it('emits each boundary exactly once across repeated ticks', () => {
    const { clock, source, ticker, boundaries } = setup(0.2);
    clock.start(0.5, 0);

    for (let i = 0; i < 40; i++) {
      source.advance(0.05);
      ticker.tick();
    }

    const times = boundaries.map((b) => b.time);
    expect(new Set(times).size).toBe(times.length);
    expect(boundaries.map((b) => b.iteration)).toEqual(
      boundaries.map((_, i) => i),
    );
  });

  it('catches up without skipping when the ticker stalls', () => {
    const { clock, source, ticker, boundaries } = setup(0.2);
    clock.start(0.25, 0);
    boundaries.length = 0;

    // Simulate a backgrounded tab: no ticks for 2s, then one late tick.
    source.advance(2);
    ticker.tick();

    // Every boundary in the stall is still emitted, in order — even though
    // they are now in the past. Playback clamps those; the clock does not
    // silently drop iterations, which would desync the loop counter.
    expect(boundaries.length).toBeGreaterThanOrEqual(8);
    expect(boundaries[0].iteration).toBe(1);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i].iteration).toBe(boundaries[i - 1].iteration + 1);
      expect(boundaries[i].time).toBeCloseTo(boundaries[i - 1].time + 0.25, 10);
    }
  });

  it('reports loop position and iteration from context time', () => {
    const { clock, source } = setup();
    clock.start(2, 0);

    source.currentTime = 0.5;
    expect(clock.getCurrentLoopPosition()).toBeCloseTo(0.5);
    expect(clock.getCurrentIteration()).toBe(0);

    source.currentTime = 5;
    expect(clock.getCurrentLoopPosition()).toBeCloseTo(1);
    expect(clock.getCurrentIteration()).toBe(2);
  });

  it('treats time before the start as position zero', () => {
    const { clock, source } = setup();
    source.currentTime = 1;
    clock.start(2, 3);

    expect(clock.getCurrentLoopPosition()).toBe(0);
    expect(clock.getCurrentIteration()).toBe(-1);
  });

  it('finds the next boundary strictly after a given time', () => {
    const { clock } = setup();
    clock.start(2, 10);

    expect(clock.getNextBoundaryAfter(5)).toBe(10);
    expect(clock.getNextBoundaryAfter(10)).toBe(12);
    expect(clock.getNextBoundaryAfter(11)).toBe(12);
    expect(clock.getNextBoundaryAfter(12)).toBe(14);
  });

  it('rejects a non-positive loop length', () => {
    const { clock } = setup();
    expect(() => clock.start(0)).toThrow();
    expect(() => clock.start(-1)).toThrow();
  });
});
