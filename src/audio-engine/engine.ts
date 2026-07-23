/**
 * Thin facade tying the engine modules together and owning their lifetimes.
 *
 * This exists so the UI has one object to talk to instead of wiring five
 * modules itself. It stays framework-agnostic — no React, no store imports —
 * per the architecture doc's core principle.
 */

import { AlignmentEngine } from './alignmentEngine';
import { getAudioContext, resumeAudioContext } from './audioContext';
import { RnnoiseBackend } from './denoiseProcessor';
import { LoopController } from './loopController';
import { Metronome } from './metronome';
import { PlaybackManager } from './playbackManager';
import { RecordingManager } from './recordingManager';
import { TransportClock } from './transportClock';
import type { DenoiseBackend } from './types';

export class LoopEngine {
  readonly ctx: AudioContext;
  readonly clock: TransportClock;
  readonly playback: PlaybackManager;
  readonly recording: RecordingManager;
  readonly alignment: AlignmentEngine;
  readonly denoise: DenoiseBackend;
  readonly metronome: Metronome;
  readonly controller: LoopController;

  constructor(ctx: AudioContext = getAudioContext(), denoise: DenoiseBackend = new RnnoiseBackend()) {
    this.ctx = ctx;
    this.clock = new TransportClock(ctx);
    this.playback = new PlaybackManager(ctx, this.clock);
    this.recording = new RecordingManager(ctx);
    this.alignment = new AlignmentEngine();
    this.denoise = denoise;
    this.metronome = new Metronome(ctx, this.clock);
    this.controller = new LoopController(
      ctx,
      this.clock,
      this.playback,
      this.recording,
      this.alignment,
      denoise,
      this.metronome,
    );
    this.playback.connect();
  }

  /** Call from a user gesture. */
  async unlock(): Promise<void> {
    await resumeAudioContext();
  }

  stopTransport(): void {
    this.clock.stop();
    this.playback.cancelPending();
  }

  async dispose(): Promise<void> {
    this.stopTransport();
    this.playback.disconnect();
    await this.recording.teardown();
    this.alignment.dispose();
    this.denoise.dispose();
    this.metronome.dispose();
  }
}

let engine: LoopEngine | null = null;

export function getEngine(): LoopEngine {
  if (!engine) {
    engine = new LoopEngine();
    if (import.meta.env.DEV) {
      // Exposed for the console only. The on-screen playhead is rAF-driven and
      // therefore stops in a backgrounded or non-compositing tab, so having a
      // way to read the transport directly matters when remote-debugging a
      // phone — where the readout is exactly what you cannot trust.
      (globalThis as unknown as { __loopEngine?: LoopEngine }).__loopEngine = engine;
    }
  }
  return engine;
}
