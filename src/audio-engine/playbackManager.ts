/**
 * PlaybackManager (§4.3) — schedules one `AudioBufferSourceNode` per track per
 * loop iteration, driven entirely by TransportClock boundary events.
 *
 * A fresh source node per iteration (rather than `source.loop = true`) is
 * deliberate: it means a track's offset, gain, or mute state can change between
 * iterations, and it keeps every track anchored to the same boundary timeline
 * instead of drifting on its own internal loop.
 */

import { MAX_LAYERS } from './constants';
import type { LoopBoundary, PlayableTrack } from './types';
import type { TransportClock } from './transportClock';

interface TrackChain {
  track: PlayableTrack;
  gainNode: GainNode;
  pannerNode: StereoPannerNode;
  /** Sources scheduled but not yet finished, so stop() can cancel them. */
  pending: Set<AudioBufferSourceNode>;
}

export class PlaybackManager {
  private readonly ctx: AudioContext;
  private readonly clock: TransportClock;
  private readonly output: GainNode;
  private readonly chains = new Map<string, TrackChain>();
  private unsubscribe: (() => void) | null = null;

  constructor(ctx: AudioContext, clock: TransportClock, destination?: AudioNode) {
    this.ctx = ctx;
    this.clock = clock;
    this.output = ctx.createGain();
    this.output.connect(destination ?? ctx.destination);
  }

  /** Master bus — a metronome or monitoring path can tap in here. */
  get outputNode(): GainNode {
    return this.output;
  }

  /** Begins responding to loop boundaries. Idempotent. */
  connect(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.clock.onBoundary((b) => this.scheduleIteration(b));
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.cancelPending();
  }

  addTrack(track: PlayableTrack): void {
    if (this.chains.has(track.id)) {
      throw new Error(`Track ${track.id} already registered`);
    }
    if (this.chains.size >= MAX_LAYERS) {
      throw new Error(`Cannot exceed MAX_LAYERS (${MAX_LAYERS})`);
    }
    const gainNode = this.ctx.createGain();
    const pannerNode = this.ctx.createStereoPanner();
    gainNode.connect(pannerNode);
    pannerNode.connect(this.output);

    const chain: TrackChain = { track, gainNode, pannerNode, pending: new Set() };
    this.chains.set(track.id, chain);
    this.applyMix(chain);
  }

  removeTrack(id: string): void {
    const chain = this.chains.get(id);
    if (!chain) return;
    for (const source of chain.pending) {
      try {
        source.stop();
      } catch {
        // Already stopped or never started — nothing to clean up.
      }
    }
    chain.gainNode.disconnect();
    chain.pannerNode.disconnect();
    this.chains.delete(id);
  }

  /**
   * Applies a partial mix change. Takes effect on the next scheduled iteration
   * for offsets, and immediately for gain/pan/mute.
   */
  updateTrack(id: string, patch: Partial<Omit<PlayableTrack, 'id'>>): void {
    const chain = this.chains.get(id);
    if (!chain) throw new Error(`Unknown track ${id}`);
    chain.track = { ...chain.track, ...patch };
    // Solo on any track changes what every other track should output.
    for (const c of this.chains.values()) this.applyMix(c);
  }

  getTrack(id: string): PlayableTrack | undefined {
    return this.chains.get(id)?.track;
  }

  get trackCount(): number {
    return this.chains.size;
  }

  /** Stops sources already scheduled — used when the transport stops. */
  cancelPending(): void {
    for (const chain of this.chains.values()) {
      for (const source of chain.pending) {
        try {
          source.stop();
        } catch {
          // Ignore: a source that never started throws on stop().
        }
      }
      chain.pending.clear();
    }
  }

  private get hasSolo(): boolean {
    for (const chain of this.chains.values()) {
      if (chain.track.soloed) return true;
    }
    return false;
  }

  private isAudible(track: PlayableTrack): boolean {
    if (track.muted) return false;
    return this.hasSolo ? track.soloed : true;
  }

  private applyMix(chain: TrackChain): void {
    const target = this.isAudible(chain.track) ? chain.track.gain : 0;
    chain.gainNode.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
    chain.pannerNode.pan.value = chain.track.pan;
  }

  private scheduleIteration(boundary: LoopBoundary): void {
    for (const chain of this.chains.values()) {
      // Muted tracks are still scheduled: gain is already 0, and scheduling
      // them keeps unmute instantaneous rather than waiting a whole loop.
      this.scheduleTrack(chain, boundary);
    }
  }

  private scheduleTrack(chain: TrackChain, boundary: LoopBoundary): void {
    const source = this.ctx.createBufferSource();
    source.buffer = chain.track.buffer;
    source.connect(chain.gainNode);

    const target = boundary.time + chain.track.offsetMs / 1000;

    if (target >= this.ctx.currentTime) {
      source.start(target);
    } else {
      // A negative offset can place the start behind us. Start now, skipping
      // into the buffer by however much we missed, so the track stays in phase.
      const skip = this.ctx.currentTime - target;
      if (skip >= chain.track.buffer.duration) return;
      source.start(this.ctx.currentTime, skip);
    }

    chain.pending.add(source);
    source.onended = () => chain.pending.delete(source);
  }
}
