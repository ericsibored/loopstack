/**
 * Metronome and count-in (§8.3).
 *
 * Clicks are synthesised per hit rather than played from a buffer: an
 * oscillator plus a short gain envelope is a few lines, needs no asset to load
 * before the first tap, and lets the downbeat differ from the other beats by
 * pitch alone.
 *
 * Beats are scheduled from loop boundaries, so the click grid is anchored to
 * the same timeline as the tracks. A metronome running on its own clock would
 * drift against the loop, which is the one thing it must never do.
 */

import type { TransportClock } from './transportClock';

const DOWNBEAT_HZ = 1600;
const BEAT_HZ = 1000;
const CLICK_SEC = 0.04;

export class Metronome {
  private readonly ctx: AudioContext;
  private readonly clock: TransportClock;
  private readonly output: GainNode;
  private unsubscribe: (() => void) | null = null;

  private enabled = false;
  private bpm: number | null = null;

  constructor(ctx: AudioContext, clock: TransportClock, destination?: AudioNode) {
    this.ctx = ctx;
    this.clock = clock;
    this.output = ctx.createGain();
    this.output.gain.value = 0.35;
    this.output.connect(destination ?? ctx.destination);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setBpm(bpm: number | null): void {
    this.bpm = bpm;
    if (this.enabled && bpm === null) this.setEnabled(false);
  }

  setEnabled(enabled: boolean): void {
    // Without a BPM there is no beat grid to click on, so this is a no-op
    // rather than a silent "enabled" state that never makes a sound.
    if (enabled && this.bpm === null) return;
    this.enabled = enabled;

    if (enabled && !this.unsubscribe) {
      this.unsubscribe = this.clock.onBoundary((boundary) => {
        if (this.enabled) this.scheduleLoopBeats(boundary.time);
      });
    } else if (!enabled && this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Fills one loop with beats, accenting the first. */
  private scheduleLoopBeats(boundaryTime: number): void {
    if (this.bpm === null) return;
    const beatSec = 60 / this.bpm;
    const loopSec = this.clock.loopLength;
    const beats = Math.max(1, Math.floor(loopSec / beatSec + 1e-6));

    for (let i = 0; i < beats; i++) {
      this.click(boundaryTime + i * beatSec, i === 0);
    }
  }

  /**
   * Schedules a count-in and returns the time the *next* bar starts — i.e.
   * when recording should begin.
   */
  scheduleCountIn(beats = 4, startAt?: number): number {
    if (this.bpm === null) throw new Error('Count-in needs a BPM');
    const beatSec = 60 / this.bpm;
    const start = startAt ?? this.ctx.currentTime + 0.1;
    for (let i = 0; i < beats; i++) {
      this.click(start + i * beatSec, i === 0);
    }
    return start + beats * beatSec;
  }

  click(when: number, accented = false): void {
    const at = Math.max(when, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();

    osc.frequency.value = accented ? DOWNBEAT_HZ : BEAT_HZ;
    osc.connect(envelope);
    envelope.connect(this.output);

    // Exponential decay to near-zero, not to zero: setTargetAtTime never
    // reaches its target, and a linear ramp on a click sounds like a thud.
    envelope.gain.setValueAtTime(accented ? 0.9 : 0.5, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_SEC);

    osc.start(at);
    osc.stop(at + CLICK_SEC);
  }

  dispose(): void {
    this.setEnabled(false);
    this.output.disconnect();
  }
}
