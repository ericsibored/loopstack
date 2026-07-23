import { describe, expect, it, beforeEach } from 'vitest';
import { LoopController } from '../../src/audio-engine/loopController';
import type { TrackSnapshot } from '../../src/audio-engine/loopController';
import { MAX_LAYERS } from '../../src/audio-engine/constants';

/**
 * The controller's ordering, mixing and A/B logic is pure bookkeeping, but it
 * reaches through PlaybackManager and AudioContext to get there. These fakes
 * record what it asked for, so the bookkeeping can be tested without audio
 * hardware or a DOM.
 */
class FakePlayback {
  readonly added: string[] = [];
  readonly removed: string[] = [];
  readonly updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  ducked = false;

  setDucked(ducked: boolean) {
    this.ducked = ducked;
  }

  addTrack(track: { id: string }) {
    this.added.push(track.id);
  }
  removeTrack(id: string) {
    this.removed.push(id);
  }
  updateTrack(id: string, patch: Record<string, unknown>) {
    this.updates.push({ id, patch });
  }
  cancelPending() {}
}

class FakeClock {
  isRunning = false;
  loopLength = 0;
  start(length: number) {
    this.isRunning = true;
    this.loopLength = length;
  }
  stop() {
    this.isRunning = false;
  }
  getCurrentLoopPosition() {
    return 0;
  }
  getNextBoundaryAfter(t: number) {
    return t;
  }
  onBoundary() {
    return () => {};
  }
}

const fakeCtx = {
  currentTime: 0,
  sampleRate: 48000,
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => data,
    };
  },
} as unknown as AudioContext;

interface Harness {
  controller: LoopController;
  playback: FakePlayback;
  auditor: { auditioningTrackId: string | null; played: string[] };
  denoiseCalls: number;
  /** Adds a committed track directly, bypassing the mic. */
  addTrack(samples?: Float32Array): string;
  tracks(): TrackSnapshot[];
}

function harness(): Harness {
  const playback = new FakePlayback();
  const clock = new FakeClock();
  const state = { denoiseCalls: 0 };

  const denoise = {
    name: 'fake',
    async process(samples: Float32Array) {
      state.denoiseCalls++;
      // Halve everything, so "processed" is measurably different from raw.
      return samples.map((v) => v / 2);
    },
    dispose() {},
  };

  const metronome = {
    isEnabled: false,
    setBpm() {},
    setEnabled() {},
    scheduleCountIn: () => 0,
    click() {},
  };

  const auditor = {
    auditioningTrackId: null as string | null,
    played: [] as string[],
    setListener() {},
    play(id: string) {
      this.auditioningTrackId = id;
      this.played.push(id);
    },
    stop() {
      this.auditioningTrackId = null;
    },
    getProgress: () => null,
  };

  const controller = new LoopController(
    fakeCtx,
    clock as never,
    playback as never,
    { isInitialized: true, isRecording: false } as never,
    {} as never,
    denoise as never,
    metronome as never,
    auditor as never,
  );

  const h: Harness = {
    controller,
    playback,
    auditor,
    get denoiseCalls() {
      return state.denoiseCalls;
    },
    addTrack(samples = new Float32Array(480).fill(0.5)) {
      // `commitTrack` is the real entry point for a finished take; calling it
      // directly is what lets these tests skip the mic.
      (controller as never as { commitTrack(s: Float32Array, r: number): void }).commitTrack(
        samples,
        48000,
      );
      const tracks = controller.snapshot().tracks;
      return tracks[tracks.length - 1].id;
    },
    tracks: () => controller.snapshot().tracks,
  };
  return h;
}

describe('LoopController ordering', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('assigns dense order values as tracks are added', () => {
    h.addTrack();
    h.addTrack();
    h.addTrack();
    expect(h.tracks().map((t) => t.order)).toEqual([0, 1, 2]);
  });

  it('moves a track down and renumbers densely', () => {
    const a = h.addTrack();
    h.addTrack();
    h.addTrack();

    h.controller.moveTrack(a, 1);

    const tracks = h.tracks();
    expect(tracks.map((t) => t.order)).toEqual([0, 1, 2]);
    expect(tracks[1].id).toBe(a);
  });

  it('moves a track up', () => {
    h.addTrack();
    h.addTrack();
    const c = h.addTrack();

    h.controller.moveTrack(c, -1);
    expect(h.tracks()[1].id).toBe(c);
  });

  it('ignores moves off either end', () => {
    const a = h.addTrack();
    const b = h.addTrack();

    h.controller.moveTrack(a, -1);
    h.controller.moveTrack(b, 1);
    expect(h.tracks().map((t) => t.id)).toEqual([a, b]);
  });

  it('closes the gap in ordering after a delete', () => {
    h.addTrack();
    const b = h.addTrack();
    h.addTrack();

    h.controller.removeTrack(b);
    expect(h.tracks().map((t) => t.order)).toEqual([0, 1]);
  });

  it('drops the loop length when the last layer is deleted', () => {
    const a = h.addTrack();
    expect(h.controller.snapshot().canRecord).toBe(true);

    h.controller.removeTrack(a);
    const snap = h.controller.snapshot();
    expect(snap.tracks).toEqual([]);
    expect(snap.loopLengthSec).toBeNull();
    expect(snap.state).toBe('idle');
  });

  it('reports canRecord false at the layer cap', () => {
    for (let i = 0; i < MAX_LAYERS; i++) h.addTrack();
    expect(h.controller.snapshot().canRecord).toBe(false);
  });

  it('returns playable tracks in display order, not insertion order', () => {
    const a = h.addTrack();
    const b = h.addTrack();
    h.controller.moveTrack(a, 1);
    expect(h.controller.getPlayableTracks().map((t) => t.id)).toEqual([b, a]);
  });
});

describe('LoopController mixing', () => {
  it('pushes gain and pan through to playback', () => {
    const h = harness();
    const id = h.addTrack();

    h.controller.updateTrack(id, { gain: 0.25, pan: -0.5 });

    const snap = h.tracks()[0];
    expect(snap.gain).toBe(0.25);
    expect(snap.pan).toBe(-0.5);
    expect(h.playback.updates.at(-1)).toEqual({ id, patch: { gain: 0.25, pan: -0.5 } });
  });
});

describe('LoopController de-noise A/B', () => {
  it('previews the processed audio without discarding the original', async () => {
    const h = harness();
    const id = h.addTrack(new Float32Array(480).fill(1));

    await h.controller.runDenoise(id);
    expect(h.tracks()[0].denoise).toBe('previewing-processed');
    // Peaks follow the audio, so a halved signal must show halved peaks.
    expect(h.tracks()[0].peaks[0]).toBeCloseTo(0.5);

    h.controller.toggleDenoisePreview(id);
    expect(h.tracks()[0].denoise).toBe('previewing-raw');
    expect(h.tracks()[0].peaks[0]).toBeCloseTo(1);
  });

  it('keeps the processed audio when accepted', async () => {
    const h = harness();
    const id = h.addTrack(new Float32Array(480).fill(1));

    await h.controller.runDenoise(id);
    h.controller.commitDenoise(id, true);

    expect(h.tracks()[0].denoise).toBe('applied');
    expect(h.tracks()[0].peaks[0]).toBeCloseTo(0.5);
  });

  it('restores the original when discarded', async () => {
    const h = harness();
    const id = h.addTrack(new Float32Array(480).fill(1));

    await h.controller.runDenoise(id);
    h.controller.commitDenoise(id, false);

    expect(h.tracks()[0].denoise).toBe('none');
    expect(h.tracks()[0].peaks[0]).toBeCloseTo(1);
  });

  it('de-noises the already-accepted audio on a second pass', async () => {
    const h = harness();
    const id = h.addTrack(new Float32Array(480).fill(1));

    await h.controller.runDenoise(id);
    h.controller.commitDenoise(id, true);
    await h.controller.runDenoise(id);

    // Second pass runs on the committed 0.5, not the original 1.0.
    expect(h.tracks()[0].peaks[0]).toBeCloseTo(0.25);
  });
});

describe('LoopController clip audition', () => {
  it('plays the requested clip and ducks the loop', () => {
    const h = harness();
    const id = h.addTrack();

    h.controller.auditionTrack(id);

    expect(h.auditor.played).toEqual([id]);
    expect(h.controller.snapshot().auditioningTrackId).toBe(id);
    expect(h.playback.ducked).toBe(true);
  });

  it('stops when the same clip is tapped again, and un-ducks', () => {
    const h = harness();
    const id = h.addTrack();

    h.controller.auditionTrack(id);
    h.controller.auditionTrack(id);

    expect(h.controller.snapshot().auditioningTrackId).toBeNull();
    expect(h.playback.ducked).toBe(false);
  });

  it('switches directly between clips without stopping first', () => {
    const h = harness();
    const a = h.addTrack();
    const b = h.addTrack();

    h.controller.auditionTrack(a);
    h.controller.auditionTrack(b);

    expect(h.auditor.played).toEqual([a, b]);
    expect(h.controller.snapshot().auditioningTrackId).toBe(b);
    expect(h.playback.ducked).toBe(true);
  });

  it('ignores an unknown track id', () => {
    const h = harness();
    h.controller.auditionTrack('nope');
    expect(h.controller.snapshot().auditioningTrackId).toBeNull();
  });
});

describe('LoopController level reporting', () => {
  it('reports true peak in dBFS alongside the normalised waveform', () => {
    const h = harness();
    h.addTrack(new Float32Array(480).fill(0.5));
    // 0.5 amplitude is about -6 dBFS.
    expect(h.tracks()[0].peakDb).toBeCloseTo(-6.02, 1);
  });

  it('reports silence as -Infinity rather than 0 dB', () => {
    const h = harness();
    h.addTrack(new Float32Array(480));
    expect(h.tracks()[0].peakDb).toBe(-Infinity);
  });
});

describe('LoopController snap-to-grid', () => {
  it('refuses to snap without a BPM, and says so', () => {
    const h = harness();
    const id = h.addTrack();
    h.controller.updateTrack(id, { offsetMs: 37 });

    h.controller.snapTrackToGrid(id);

    expect(h.tracks()[0].offsetMs).toBe(37);
    expect(h.controller.snapshot().error).toMatch(/BPM/i);
  });

  it('rounds the offset to the nearest beat once a BPM is set', () => {
    const h = harness();
    const id = h.addTrack();
    h.controller.setBpm(120); // 500ms per beat
    h.controller.updateTrack(id, { offsetMs: 260 });

    h.controller.snapTrackToGrid(id);
    expect(h.tracks()[0].offsetMs).toBe(500);
  });
});
