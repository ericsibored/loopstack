import { describe, expect, it } from 'vitest';
import { computePeaks } from '../../src/audio-engine/loopController';
import { isAudible } from '../../src/audio-engine/mixdownRenderer';
import { getTrimRegion, type PlayableTrack } from '../../src/audio-engine/types';

/** `buffer` is never read by `isAudible`, so a stub keeps this DOM-free. */
function track(partial: Partial<PlayableTrack> & { id: string }): PlayableTrack {
  return {
    buffer: null as unknown as AudioBuffer,
    offsetMs: 0,
    gain: 1,
    pan: 0,
    muted: false,
    soloed: false,
    ...partial,
  };
}

function trackWithBuffer(duration: number, partial: Partial<PlayableTrack> = {}): PlayableTrack {
  return track({
    id: 'x',
    buffer: { duration } as AudioBuffer,
    ...partial,
  });
}

describe('isAudible', () => {
  it('includes every unmuted track when nothing is soloed', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b' })];
    expect(tracks.filter((t) => isAudible(t, tracks)).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('excludes muted tracks', () => {
    const tracks = [track({ id: 'a', muted: true }), track({ id: 'b' })];
    expect(tracks.filter((t) => isAudible(t, tracks)).map((t) => t.id)).toEqual(['b']);
  });

  it('restricts to soloed tracks when any track is soloed', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b', soloed: true }), track({ id: 'c' })];
    expect(tracks.filter((t) => isAudible(t, tracks)).map((t) => t.id)).toEqual(['b']);
  });

  it('keeps mute winning over solo on the same track', () => {
    // Both flags set is reachable by tapping M then S. Mute should win, or the
    // export contains a track the user explicitly silenced.
    const tracks = [track({ id: 'a', soloed: true, muted: true }), track({ id: 'b' })];
    expect(tracks.filter((t) => isAudible(t, tracks))).toEqual([]);
  });
});

describe('getTrimRegion', () => {
  it('defaults to the whole buffer when untrimmed', () => {
    expect(getTrimRegion(trackWithBuffer(2))).toEqual({ startSec: 0, durationSec: 2 });
  });

  it('treats a null end as the end of the buffer', () => {
    expect(getTrimRegion(trackWithBuffer(2, { trimStartSec: 0.5, trimEndSec: null }))).toEqual({
      startSec: 0.5,
      durationSec: 1.5,
    });
  });

  it('returns the cropped region', () => {
    expect(getTrimRegion(trackWithBuffer(4, { trimStartSec: 1, trimEndSec: 3 }))).toEqual({
      startSec: 1,
      durationSec: 2,
    });
  });

  it('clamps bounds that run past the buffer', () => {
    expect(getTrimRegion(trackWithBuffer(2, { trimStartSec: -1, trimEndSec: 99 }))).toEqual({
      startSec: 0,
      durationSec: 2,
    });
  });

  it('never returns a negative duration when the bounds are inverted', () => {
    // Reachable by dragging one handle past the other; must not produce a
    // negative duration, which would throw inside AudioBufferSourceNode.start.
    const region = getTrimRegion(trackWithBuffer(2, { trimStartSec: 1.5, trimEndSec: 0.5 }));
    expect(region.durationSec).toBe(0);
    expect(region.startSec).toBe(1.5);
  });
});

describe('computePeaks', () => {
  it('returns exactly the requested bucket count', () => {
    expect(computePeaks(new Float32Array(10000), 480).length).toBe(480);
    expect(computePeaks(new Float32Array(7), 480).length).toBe(480);
  });

  it('takes the peak within each bucket, not the average', () => {
    // One loud sample in an otherwise silent bucket must survive — averaging
    // would flatten percussive material into nothing.
    const samples = new Float32Array(1000);
    samples[10] = 0.9;
    const peaks = computePeaks(samples, 10);

    expect(peaks[0]).toBeCloseTo(0.9);
    expect(peaks[1]).toBe(0);
  });

  it('uses absolute amplitude', () => {
    const samples = Float32Array.from([-0.7, 0.2]);
    expect(computePeaks(samples, 1)[0]).toBeCloseTo(0.7);
  });

  it('handles an empty signal', () => {
    expect(Array.from(computePeaks(new Float32Array(0), 4))).toEqual([0, 0, 0, 0]);
  });
});
