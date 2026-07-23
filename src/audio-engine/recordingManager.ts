/**
 * RecordingManager (§4.2).
 *
 * Capture is continuous and untrimmed; loop alignment happens afterwards in
 * `sliceLoop()`. This is on purpose — a worklet cannot be sample-scheduled the
 * way a source node can, so rather than trying to *start* capture exactly on a
 * boundary, we start early, record when capture actually began, and cut the
 * loop out of the middle. The cut is sample-accurate; a scheduled start would
 * not have been.
 */

import type { CaptureResult } from './types';

export interface MicConstraints {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

/**
 * Defaults for looping over speakers. Browser noiseSuppression is the baseline
 * de-noise per §6.4; echoCancellation is left on because a phone speaker
 * bleeding into the mic is the common case for this app.
 */
export const DEFAULT_MIC_CONSTRAINTS: MicConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

const WORKLET_URL = '/worklets/recorder-worklet.js';

export class RecordingManager {
  private readonly ctx: AudioContext;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private workletLoaded = false;

  private chunks: Float32Array[] = [];
  private captureStartTime: number | null = null;
  private captureSampleRate = 0;
  private recording = false;
  private stopResolve: ((result: CaptureResult) => void) | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  get isInitialized(): boolean {
    return this.workletNode !== null;
  }

  /**
   * Acquires the mic and wires it into the worklet. Must be called from a user
   * gesture on iOS Safari, and re-called if constraints change (the constraints
   * are applied at getUserMedia time, not per recording).
   */
  async init(constraints: MicConstraints = DEFAULT_MIC_CONSTRAINTS): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: constraints.echoCancellation,
        noiseSuppression: constraints.noiseSuppression,
        autoGainControl: constraints.autoGainControl,
        channelCount: 1,
      },
      video: false,
    });
    await this.attachStream(stream);
  }

  /**
   * Wires an arbitrary MediaStream into the capture path instead of the mic.
   *
   * Everything downstream — the worklet, the capture-start timestamp, slicing —
   * is identical, which is the point: it makes the full record path exercisable
   * on a machine with no microphone (see `src/dev/virtualMic.ts`).
   */
  async attachStream(stream: MediaStream): Promise<void> {
    await this.teardown();
    this.stream = stream;

    if (!this.workletLoaded) {
      await this.ctx.audioWorklet.addModule(WORKLET_URL);
      this.workletLoaded = true;
    }

    this.sourceNode = this.ctx.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(this.ctx, 'recorder-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    this.workletNode.port.onmessage = (event) => this.onWorkletMessage(event.data);
    this.sourceNode.connect(this.workletNode);
  }

  /** Returns the actual capture settings the browser granted, for diagnostics. */
  getAppliedConstraints(): MediaTrackSettings | null {
    const track = this.stream?.getAudioTracks()[0];
    return track ? track.getSettings() : null;
  }

  start(): void {
    if (!this.workletNode) throw new Error('RecordingManager.init() not called');
    if (this.recording) return;
    this.chunks = [];
    this.captureStartTime = null;
    this.recording = true;
    this.workletNode.port.postMessage({ type: 'start' });
  }

  stop(): Promise<CaptureResult> {
    if (!this.workletNode || !this.recording) {
      return Promise.reject(new Error('Not recording'));
    }
    this.recording = false;
    return new Promise<CaptureResult>((resolve) => {
      this.stopResolve = resolve;
      this.workletNode!.port.postMessage({ type: 'stop' });
    });
  }

  async teardown(): Promise<void> {
    this.recording = false;
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private onWorkletMessage(data: {
    type: string;
    startTime?: number;
    sampleRate?: number;
    samples?: Float32Array;
  }): void {
    if (data.type === 'started') {
      this.captureStartTime = data.startTime ?? this.ctx.currentTime;
      this.captureSampleRate = data.sampleRate ?? this.ctx.sampleRate;
    } else if (data.type === 'chunk' && data.samples) {
      this.chunks.push(data.samples);
    } else if (data.type === 'stopped') {
      this.finalize();
    }
  }

  private finalize(): void {
    const resolve = this.stopResolve;
    this.stopResolve = null;
    if (!resolve) return;

    const total = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];

    resolve({
      samples,
      sampleRate: this.captureSampleRate || this.ctx.sampleRate,
      startTime: this.captureStartTime ?? 0,
    });
  }
}

/**
 * Cuts one loop's worth of audio out of a continuous capture.
 *
 * `inputLatencyOffsetMs` is the measured round-trip delay (§6.2): sound that
 * belongs at loop position 0 physically arrives that much later, so we slice
 * that much later too. Regions before capture start or past capture end are
 * zero-filled rather than shifting the audio, which would put it out of phase.
 */
export function sliceLoop(
  capture: CaptureResult,
  boundaryTime: number,
  loopLengthSec: number,
  inputLatencyOffsetMs = 0,
): Float32Array {
  const { samples, sampleRate, startTime } = capture;
  const length = Math.round(loopLengthSec * sampleRate);
  const out = new Float32Array(length);

  const sliceStartSec = boundaryTime + inputLatencyOffsetMs / 1000 - startTime;
  const from = Math.round(sliceStartSec * sampleRate);

  for (let i = 0; i < length; i++) {
    const src = from + i;
    if (src >= 0 && src < samples.length) out[i] = samples[src];
  }
  return out;
}

/** Wraps raw mono samples in an AudioBuffer for playback. */
export function toAudioBuffer(
  ctx: BaseAudioContext,
  samples: Float32Array,
  sampleRate: number,
): AudioBuffer {
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  // `set` rather than `copyToChannel`: the latter's signature pins the backing
  // store to ArrayBuffer, and our sample arrays come back from workers typed as
  // ArrayBufferLike. Same copy, no cast.
  buffer.getChannelData(0).set(samples);
  return buffer;
}
