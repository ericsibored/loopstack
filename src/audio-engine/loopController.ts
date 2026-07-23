/**
 * LoopController — the looper state machine, framework-agnostic.
 *
 * This is where "what a looper does" lives: the first recording defines the
 * loop length, every subsequent one is an overdub locked to a loop boundary and
 * auto-stops after exactly one lap. The UI only sends intents (`toggleRecord`,
 * `stop`) and renders whatever state comes back — it never sequences these
 * steps itself, because getting that ordering right is the hard part and it
 * should be testable without a DOM.
 */

import { AlignmentEngine, generateClick } from './alignmentEngine';
import type { ClipAuditor } from './clipAuditor';
import { MAX_LAYERS } from './constants';
import type { Metronome } from './metronome';
import { PlaybackManager } from './playbackManager';
import { RecordingManager, sliceLoop, toAudioBuffer } from './recordingManager';
import type { MicConstraints } from './recordingManager';
import { TransportClock } from './transportClock';
import type { DenoiseBackend, PlayableTrack } from './types';

/**
 * `armed` is its own state rather than a flag on `recording`: the user has
 * committed but audio is not being kept yet, and the UI has to say so or the
 * wait feels like a bug.
 */
export type ControllerState =
  | 'idle'
  | 'counting-in'
  | 'armed'
  | 'recording'
  | 'playing'
  | 'stopped'
  | 'calibrating';

/** Where a track sits in the de-noise A/B flow (§6.4). */
export type DenoiseState = 'none' | 'processing' | 'previewing-raw' | 'previewing-processed' | 'applied';

export interface ControllerSnapshot {
  state: ControllerState;
  loopLengthSec: number | null;
  bpm: number | null;
  metronomeEnabled: boolean;
  countInBeats: number;
  tracks: TrackSnapshot[];
  inputLatencyOffsetMs: number;
  calibrated: boolean;
  canRecord: boolean;
  /** Clip currently being auditioned in isolation, if any. */
  auditioningTrackId: string | null;
  error: string | null;
  status: string | null;
}

export interface TrackSnapshot {
  id: string;
  label: string;
  order: number;
  /** Mono peak data for waveform drawing, downsampled once at capture time. */
  peaks: Float32Array;
  durationSec: number;
  /** True peak of the captured audio, in dBFS. -Infinity for silence. */
  peakDb: number;
  offsetMs: number;
  gain: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
  denoise: DenoiseState;
  /** Pending auto-align suggestion, awaiting accept or reject. */
  alignSuggestionMs: number | null;
  alignConfidence: number | null;
}

interface TrackEntry {
  track: PlayableTrack;
  snapshot: TrackSnapshot;
  /** Samples as captured. Kept so de-noise stays revertible and align can re-run. */
  raw: Float32Array;
  processed: Float32Array | null;
  sampleRate: number;
}

/** How many peak buckets to compute per track. Enough for a phone-width canvas. */
const PEAK_BUCKETS = 480;

/** Margin past the end of the recorded loop before capture is cut off. */
const OVERDUB_TAIL_MS = 300;

const CALIBRATION_CLICK_DELAY_SEC = 0.3;
const CALIBRATION_CAPTURE_MS = 1200;

export class LoopController {
  private readonly ctx: AudioContext;
  private readonly clock: TransportClock;
  private readonly playback: PlaybackManager;
  private readonly recording: RecordingManager;
  private readonly alignment: AlignmentEngine;
  private readonly denoiseBackend: DenoiseBackend;
  private readonly metronome: Metronome;
  private readonly auditor: ClipAuditor;

  private state: ControllerState = 'idle';
  private loopLengthSec: number | null = null;
  private bpm: number | null = null;
  private countInBeats = 0;
  private inputLatencyOffsetMs = 0;
  private calibrated = false;
  private error: string | null = null;
  private status: string | null = null;

  private readonly tracks = new Map<string, TrackEntry>();
  private readonly listeners = new Set<(snapshot: ControllerSnapshot) => void>();

  private recordStartTime = 0;
  private overdubTimer: ReturnType<typeof setTimeout> | null = null;
  private countInTimer: ReturnType<typeof setTimeout> | null = null;
  private trackCounter = 0;

  constructor(
    ctx: AudioContext,
    clock: TransportClock,
    playback: PlaybackManager,
    recording: RecordingManager,
    alignment: AlignmentEngine,
    denoise: DenoiseBackend,
    metronome: Metronome,
    auditor: ClipAuditor,
  ) {
    this.ctx = ctx;
    this.clock = clock;
    this.playback = playback;
    this.recording = recording;
    this.alignment = alignment;
    this.denoiseBackend = denoise;
    this.metronome = metronome;
    this.auditor = auditor;

    // The clip ends on its own; the loop has to be un-ducked when it does.
    this.auditor.setListener(() => {
      this.playback.setDucked(this.auditor.auditioningTrackId !== null);
      this.emit();
    });
  }

  subscribe(listener: (snapshot: ControllerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): ControllerSnapshot {
    return {
      state: this.state,
      loopLengthSec: this.loopLengthSec,
      bpm: this.bpm,
      metronomeEnabled: this.metronome.isEnabled,
      countInBeats: this.countInBeats,
      tracks: [...this.tracks.values()]
        .map((t) => t.snapshot)
        .sort((a, b) => a.order - b.order),
      inputLatencyOffsetMs: this.inputLatencyOffsetMs,
      calibrated: this.calibrated,
      canRecord: this.tracks.size < MAX_LAYERS,
      auditioningTrackId: this.auditor.auditioningTrackId,
      error: this.error,
      status: this.status,
    };
  }

  // ---------------------------------------------------------------- settings

  setInputLatency(ms: number): void {
    this.inputLatencyOffsetMs = ms;
    this.emit();
  }

  setBpm(bpm: number | null): void {
    this.bpm = bpm;
    this.metronome.setBpm(bpm);
    if (bpm === null) this.countInBeats = 0;
    this.emit();
  }

  setMetronome(enabled: boolean): void {
    this.metronome.setEnabled(enabled);
    this.emit();
  }

  setCountInBeats(beats: number): void {
    this.countInBeats = Math.max(0, beats);
    this.emit();
  }

  get isRecording(): boolean {
    return this.state === 'recording' || this.state === 'armed' || this.state === 'counting-in';
  }

  /** Acquires the mic. Must be called from a user gesture on iOS Safari. */
  async initMic(constraints: MicConstraints): Promise<void> {
    await this.recording.init(constraints);
    this.error = null;
    this.emit();
  }

  get micReady(): boolean {
    return this.recording.isInitialized;
  }

  // --------------------------------------------------------------- recording

  /**
   * The single record intent. What it means depends on where we are: stop a
   * first take, cancel an armed overdub, or start something new.
   */
  async toggleRecord(): Promise<void> {
    try {
      this.error = null;
      if (this.state === 'recording' && this.loopLengthSec === null) {
        await this.finishFirstRecording();
      } else if (this.isRecording) {
        this.cancelRecording();
      } else if (this.loopLengthSec === null) {
        this.beginFirstTake();
      } else {
        this.startOverdub();
      }
    } catch (e) {
      this.fail(e);
    }
  }

  /**
   * A count-in only makes sense before the first take — after that the loop
   * boundary already tells you where "one" is.
   */
  private beginFirstTake(): void {
    this.requireMic();
    if (this.countInBeats > 0 && this.bpm !== null) {
      const startAt = this.metronome.scheduleCountIn(this.countInBeats);
      this.state = 'counting-in';
      this.status = `Count-in: ${this.countInBeats} beats`;
      this.emit();
      this.countInTimer = setTimeout(
        () => {
          this.countInTimer = null;
          if (this.state !== 'counting-in') return;
          this.startFirstRecording();
        },
        Math.max(0, (startAt - this.ctx.currentTime) * 1000),
      );
      return;
    }
    this.startFirstRecording();
  }

  /** First take: capture runs free and defines the loop when it's stopped. */
  private startFirstRecording(): void {
    this.requireMic();
    this.recording.start();
    this.recordStartTime = this.ctx.currentTime;
    this.state = 'recording';
    this.status = null;
    this.emit();
  }

  private async finishFirstRecording(): Promise<void> {
    // Length comes from the gap between the two button presses, not from how
    // much audio arrived — capture starts a render quantum or two early and the
    // mic keeps running slightly past the stop.
    let loopLengthSec = this.ctx.currentTime - this.recordStartTime;
    const capture = await this.recording.stop();

    if (loopLengthSec <= 0.05) {
      this.state = 'idle';
      this.error = 'Take was too short — hold record for at least a moment.';
      this.emit();
      return;
    }

    // With a BPM set, round the loop to a whole number of beats. A loop that is
    // 1.97 beats long can never be made to line up by nudging.
    if (this.bpm !== null) {
      const beatSec = 60 / this.bpm;
      const beats = Math.max(1, Math.round(loopLengthSec / beatSec));
      loopLengthSec = beats * beatSec;
      this.status = `Loop snapped to ${beats} beat${beats === 1 ? '' : 's'} at ${this.bpm} BPM`;
    }

    const samples = sliceLoop(
      capture,
      this.recordStartTime,
      loopLengthSec,
      this.inputLatencyOffsetMs,
    );

    this.loopLengthSec = loopLengthSec;
    this.clock.start(loopLengthSec);
    this.commitTrack(samples, capture.sampleRate);
    this.state = 'playing';
    this.emit();
  }

  /** Overdub: capture starts now, but only the next full loop is kept. */
  private startOverdub(): void {
    this.requireMic();
    if (this.tracks.size >= MAX_LAYERS) {
      throw new Error(`Layer limit reached (${MAX_LAYERS}).`);
    }
    if (!this.clock.isRunning) this.resumeTransport();

    const loopLengthSec = this.loopLengthSec!;
    this.recording.start();

    // Arm slightly ahead so the boundary we target is definitely still in the
    // future by the time capture is actually running.
    const boundary = this.clock.getNextBoundaryAfter(this.ctx.currentTime + 0.1);
    this.state = 'armed';
    this.emit();

    const untilBoundaryMs = (boundary - this.ctx.currentTime) * 1000;
    setTimeout(() => {
      if (this.state === 'armed') {
        this.state = 'recording';
        this.emit();
      }
    }, Math.max(0, untilBoundaryMs));

    const totalMs =
      untilBoundaryMs + loopLengthSec * 1000 + Math.abs(this.inputLatencyOffsetMs) + OVERDUB_TAIL_MS;

    this.overdubTimer = setTimeout(() => {
      void this.finishOverdub(boundary);
    }, totalMs);
  }

  private async finishOverdub(boundary: number): Promise<void> {
    try {
      this.overdubTimer = null;
      const capture = await this.recording.stop();
      const samples = sliceLoop(
        capture,
        boundary,
        this.loopLengthSec!,
        this.inputLatencyOffsetMs,
      );
      this.commitTrack(samples, capture.sampleRate);
      this.state = 'playing';
      this.emit();
    } catch (e) {
      this.fail(e);
    }
  }

  private cancelRecording(): void {
    for (const timer of [this.overdubTimer, this.countInTimer]) {
      if (timer !== null) clearTimeout(timer);
    }
    this.overdubTimer = null;
    this.countInTimer = null;
    // Discard whatever was captured; a cancelled take leaves no track.
    if (this.recording.isRecording) {
      void this.recording.stop().catch(() => undefined);
    }
    this.state = this.loopLengthSec === null ? 'idle' : 'playing';
    this.status = null;
    this.emit();
  }

  private commitTrack(samples: Float32Array, sampleRate: number): void {
    const id = `track-${++this.trackCounter}`;
    const track: PlayableTrack = {
      id,
      buffer: toAudioBuffer(this.ctx, samples, sampleRate),
      offsetMs: 0,
      gain: 0.9,
      pan: 0,
      muted: false,
      soloed: false,
    };
    this.playback.addTrack(track);
    this.tracks.set(id, {
      track,
      raw: samples,
      processed: null,
      sampleRate,
      snapshot: {
        id,
        label: `Layer ${this.trackCounter}`,
        order: this.tracks.size,
        peaks: computePeaks(samples, PEAK_BUCKETS),
        durationSec: samples.length / sampleRate,
        peakDb: peakDb(samples),
        offsetMs: 0,
        gain: track.gain,
        pan: track.pan,
        muted: false,
        soloed: false,
        denoise: 'none',
        alignSuggestionMs: null,
        alignConfidence: null,
      },
    });
  }

  // ------------------------------------------------------------------ mixing

  updateTrack(
    id: string,
    patch: Partial<Pick<TrackSnapshot, 'offsetMs' | 'gain' | 'pan' | 'muted' | 'soloed'>>,
  ): void {
    const entry = this.tracks.get(id);
    if (!entry) return;
    entry.track = { ...entry.track, ...patch };
    entry.snapshot = { ...entry.snapshot, ...patch };
    this.playback.updateTrack(id, patch);
    this.emit();
  }

  /** Moves a track up (-1) or down (+1) in the layer list. */
  moveTrack(id: string, delta: number): void {
    const ordered = [...this.tracks.values()].sort((a, b) => a.snapshot.order - b.snapshot.order);
    const index = ordered.findIndex((e) => e.snapshot.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ordered.length) return;

    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    // Renumber from scratch rather than swapping two values, so order stays a
    // dense 0..n-1 sequence no matter how many moves have happened.
    ordered.forEach((entry, i) => {
      entry.snapshot = { ...entry.snapshot, order: i };
    });
    this.emit();
  }

  removeTrack(id: string): void {
    if (!this.tracks.has(id)) return;
    this.playback.removeTrack(id);
    this.tracks.delete(id);

    [...this.tracks.values()]
      .sort((a, b) => a.snapshot.order - b.snapshot.order)
      .forEach((entry, i) => {
        entry.snapshot = { ...entry.snapshot, order: i };
      });

    if (this.tracks.size === 0) {
      // Last layer gone: the loop length was defined by a take that no longer
      // exists, so drop it and let the next recording define a new one.
      this.stopTransport();
      this.loopLengthSec = null;
      this.state = 'idle';
    }
    this.emit();
  }

  /** Tracks in display order, for mixdown. */
  getPlayableTracks(): PlayableTrack[] {
    return [...this.tracks.values()]
      .sort((a, b) => a.snapshot.order - b.snapshot.order)
      .map((t) => t.track);
  }

  // --------------------------------------------------------------- transport

  play(): void {
    if (this.loopLengthSec === null || this.clock.isRunning) return;
    this.resumeTransport();
    this.state = 'playing';
    this.emit();
  }

  stop(): void {
    if (this.isRecording) this.cancelRecording();
    this.stopTransport();
    this.state = this.loopLengthSec === null ? 'idle' : 'stopped';
    this.emit();
  }

  private resumeTransport(): void {
    this.clock.start(this.loopLengthSec!);
  }

  private stopTransport(): void {
    this.clock.stop();
    this.playback.cancelPending();
  }

  getLoopPosition(): number {
    return this.clock.getCurrentLoopPosition();
  }

  // ------------------------------------------------------------- calibration

  /**
   * Measures the speaker→mic round trip (§6.2) and stores it, so later
   * recordings are sliced at the right place without any manual nudging.
   */
  async calibrate(): Promise<void> {
    try {
      this.requireMic();
      const wasRunning = this.clock.isRunning;
      // Anything else coming out of the speaker would be picked up as well and
      // could be mistaken for the click.
      this.stopTransport();

      this.state = 'calibrating';
      this.status = 'Listening for the click — keep the room quiet.';
      this.error = null;
      this.emit();

      this.recording.start();

      const sampleRate = this.ctx.sampleRate;
      const click = generateClick(sampleRate);
      const source = this.ctx.createBufferSource();
      source.buffer = toAudioBuffer(this.ctx, click, sampleRate);
      source.connect(this.ctx.destination);
      const clickTime = this.ctx.currentTime + CALIBRATION_CLICK_DELAY_SEC;
      source.start(clickTime);

      await delay(CALIBRATION_CAPTURE_MS);
      const capture = await this.recording.stop();

      const result = AlignmentEngine.computeCalibration(
        capture.samples,
        capture.sampleRate,
        capture.startTime,
        clickTime,
      );

      if (!result.detected) {
        this.status = null;
        this.error = 'No click heard. Turn the volume up, use speakers not headphones, and retry.';
      } else if (result.inputLatencyOffsetMs < 0 || result.inputLatencyOffsetMs > 500) {
        // A plausible round trip is tens of milliseconds. Anything outside this
        // means we locked onto room noise, and applying it would be worse than
        // staying uncalibrated.
        this.status = null;
        this.error = `Measured ${result.inputLatencyOffsetMs.toFixed(0)}ms, which is out of range — retry somewhere quieter.`;
      } else {
        this.inputLatencyOffsetMs = result.inputLatencyOffsetMs;
        this.calibrated = true;
        this.status = `Latency measured: ${result.inputLatencyOffsetMs.toFixed(1)}ms`;
      }

      this.state = this.loopLengthSec === null ? 'idle' : 'stopped';
      if (wasRunning) this.play();
      this.emit();
    } catch (e) {
      this.fail(e);
    }
  }

  // --------------------------------------------------------------- alignment

  /**
   * Cross-correlates a track against the first layer and stores the result as a
   * *suggestion*. Never applied automatically — accepting is the user's call.
   */
  async requestAlignment(id: string): Promise<void> {
    try {
      const entry = this.tracks.get(id);
      if (!entry) return;

      const reference = [...this.tracks.values()]
        .sort((a, b) => a.snapshot.order - b.snapshot.order)
        .find((e) => e.snapshot.id !== id);
      if (!reference) {
        this.error = 'Auto-align needs another layer to line up against.';
        this.emit();
        return;
      }

      const suggestion = await this.alignment.suggestAlignment(
        reference.raw,
        entry.raw,
        entry.sampleRate,
      );

      entry.snapshot = {
        ...entry.snapshot,
        // Relative to where the track already sits, so a suggestion made after
        // a manual nudge does not silently discard that nudge.
        alignSuggestionMs: entry.snapshot.offsetMs + suggestion.suggestedOffsetMs,
        alignConfidence: suggestion.confidence,
      };
      this.status = `Suggested ${suggestion.suggestedOffsetMs.toFixed(1)}ms (confidence ${suggestion.confidence.toFixed(2)})`;
      this.emit();
    } catch (e) {
      this.fail(e);
    }
  }

  acceptAlignment(id: string): void {
    const entry = this.tracks.get(id);
    if (!entry || entry.snapshot.alignSuggestionMs === null) return;
    const offsetMs = entry.snapshot.alignSuggestionMs;
    this.clearSuggestion(entry);
    this.updateTrack(id, { offsetMs });
  }

  rejectAlignment(id: string): void {
    const entry = this.tracks.get(id);
    if (!entry) return;
    this.clearSuggestion(entry);
    this.emit();
  }

  /** Rounds a track's offset to the nearest beat (§4.4). Needs a BPM. */
  snapTrackToGrid(id: string, subdivision = 1): void {
    const entry = this.tracks.get(id);
    if (!entry) return;
    if (this.bpm === null) {
      this.error = 'Set a BPM before snapping to the grid.';
      this.emit();
      return;
    }
    this.updateTrack(id, {
      offsetMs: AlignmentEngine.snapToGrid(entry.snapshot.offsetMs, this.bpm, subdivision),
    });
  }

  private clearSuggestion(entry: TrackEntry): void {
    entry.snapshot = { ...entry.snapshot, alignSuggestionMs: null, alignConfidence: null };
  }

  // ----------------------------------------------------------------- denoise

  /**
   * Runs the post-capture de-noise pass and swaps the track to the processed
   * version *while the loop keeps playing* (§6.4).
   *
   * A/B in context beats a separate preview player: noise reduction artefacts
   * are far easier to hear against the other layers than in isolation, which is
   * the judgement the user is actually being asked to make.
   */
  async runDenoise(id: string): Promise<void> {
    const entry = this.tracks.get(id);
    if (!entry) return;
    try {
      entry.snapshot = { ...entry.snapshot, denoise: 'processing' };
      this.status = 'De-noising…';
      this.error = null;
      this.emit();

      const processed = await this.denoiseBackend.process(entry.raw, entry.sampleRate);
      entry.processed = processed;
      this.swapBuffer(entry, processed);
      entry.snapshot = { ...entry.snapshot, denoise: 'previewing-processed' };
      this.status = 'Previewing de-noised audio — A/B it, then keep or discard.';
      this.emit();
    } catch (e) {
      entry.snapshot = { ...entry.snapshot, denoise: 'none' };
      this.fail(e);
    }
  }

  /** Flips the previewed track between raw and processed, live. */
  toggleDenoisePreview(id: string): void {
    const entry = this.tracks.get(id);
    if (!entry || !entry.processed) return;

    const showProcessed = entry.snapshot.denoise !== 'previewing-processed';
    this.swapBuffer(entry, showProcessed ? entry.processed : entry.raw);
    entry.snapshot = {
      ...entry.snapshot,
      denoise: showProcessed ? 'previewing-processed' : 'previewing-raw',
    };
    this.emit();
  }

  commitDenoise(id: string, accept: boolean): void {
    const entry = this.tracks.get(id);
    if (!entry || !entry.processed) return;

    if (accept) {
      entry.raw = entry.processed;
      this.swapBuffer(entry, entry.raw);
      entry.snapshot = { ...entry.snapshot, denoise: 'applied' };
      this.status = 'De-noise applied.';
    } else {
      this.swapBuffer(entry, entry.raw);
      entry.snapshot = { ...entry.snapshot, denoise: 'none' };
      this.status = 'De-noise discarded.';
    }
    entry.processed = null;
    this.emit();
  }

  /** Swaps a track's audio and its waveform together, so they never disagree. */
  private swapBuffer(entry: TrackEntry, samples: Float32Array): void {
    const buffer = toAudioBuffer(this.ctx, samples, entry.sampleRate);
    entry.track = { ...entry.track, buffer };
    this.playback.updateTrack(entry.snapshot.id, { buffer });
    entry.snapshot = {
      ...entry.snapshot,
      peaks: computePeaks(samples, PEAK_BUCKETS),
      peakDb: peakDb(samples),
    };
  }

  // ---------------------------------------------------------------- auditing

  /**
   * Plays one clip in isolation so it can be checked on its own. Tapping the
   * clip that is already playing stops it, so the same control does both.
   */
  auditionTrack(id: string, loop = false): void {
    if (this.auditor.auditioningTrackId === id) {
      this.stopAudition();
      return;
    }
    const entry = this.tracks.get(id);
    if (!entry) return;

    this.playback.setDucked(true);
    this.auditor.play(id, entry.track.buffer, loop);
  }

  stopAudition(): void {
    this.auditor.stop();
    this.playback.setDucked(false);
  }

  /** 0-1 through the auditioned clip, for its playhead. */
  getAuditionProgress(): number | null {
    return this.auditor.getProgress();
  }

  // ------------------------------------------------------------------ common

  clearStatus(): void {
    this.status = null;
    this.error = null;
    this.emit();
  }

  private requireMic(): void {
    if (!this.recording.isInitialized) {
      throw new Error('Microphone not enabled yet.');
    }
  }

  private fail(e: unknown): void {
    this.error = e instanceof Error ? e.message : String(e);
    this.status = null;
    this.state = this.loopLengthSec === null ? 'idle' : 'playing';
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/**
 * Downsamples to per-bucket peak amplitude for waveform drawing.
 *
 * Peak, not average: an averaged waveform of percussive material looks nearly
 * flat, which makes it useless for the thing users actually do with it — seeing
 * where the hits are so they can line layers up.
 */
export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  if (samples.length === 0) return out;

  const perBucket = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * perBucket);
    const end = Math.min(samples.length, Math.floor((b + 1) * perBucket));
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

/**
 * True peak in dBFS.
 *
 * Reported alongside the waveform because the waveform itself is normalised for
 * visibility — without a number next to it, a clip recorded at -40 dB would
 * look identical to a healthy one.
 */
export function peakDb(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak === 0 ? -Infinity : 20 * Math.log10(peak);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
