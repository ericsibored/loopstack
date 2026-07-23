/**
 * TransportClock (§4.1) — the single source of truth for "where are we in the
 * loop."
 *
 * All timing derives from `AudioContext.currentTime`. The ticker decides *when
 * we think about scheduling*; it never decides *when audio starts*. That
 * separation is what makes the lookahead pattern tolerant of a jittery timer.
 */

import {
  LOOKAHEAD_INTERVAL_MS,
  SCHEDULE_AHEAD_SEC,
  TRANSPORT_START_DELAY_SEC,
} from './constants';
import { createTicker, type Ticker } from './ticker';
import type { BoundaryListener, LoopBoundary } from './types';

/** The only part of AudioContext the clock needs — keeps it unit-testable. */
export interface ClockSource {
  readonly currentTime: number;
}

export interface TransportClockOptions {
  ticker?: Ticker;
  scheduleAheadSec?: number;
  lookaheadIntervalMs?: number;
}

export class TransportClock {
  private readonly source: ClockSource;
  private readonly ticker: Ticker;
  private readonly scheduleAheadSec: number;
  private readonly lookaheadIntervalMs: number;
  private readonly listeners = new Set<BoundaryListener>();

  private running = false;
  private loopLengthSec = 0;
  private startTime = 0;
  /** Next boundary not yet handed to listeners. */
  private nextBoundaryTime = 0;
  private nextIteration = 0;

  constructor(source: ClockSource, options: TransportClockOptions = {}) {
    this.source = source;
    this.ticker = options.ticker ?? createTicker();
    this.scheduleAheadSec = options.scheduleAheadSec ?? SCHEDULE_AHEAD_SEC;
    this.lookaheadIntervalMs = options.lookaheadIntervalMs ?? LOOKAHEAD_INTERVAL_MS;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Scheduler health, for the diagnostics readout.
   *
   * `boundariesEmitted` is the number that matters: if it stops climbing while
   * the transport says it is running, the scheduler has stalled and the audio
   * has gone quiet — which is otherwise very hard to tell apart from a mixing
   * or capture problem.
   */
  getHealth(): {
    running: boolean;
    boundariesEmitted: number;
    nextBoundaryTime: number;
    secondsUntilNextBoundary: number;
    workerTickerAlive: boolean | null;
  } {
    const ticker = this.ticker as { workerAlive?: boolean };
    return {
      running: this.running,
      boundariesEmitted: this.nextIteration,
      nextBoundaryTime: this.nextBoundaryTime,
      secondsUntilNextBoundary: this.nextBoundaryTime - this.source.currentTime,
      workerTickerAlive: typeof ticker.workerAlive === 'boolean' ? ticker.workerAlive : null,
    };
  }

  get loopLength(): number {
    return this.loopLengthSec;
  }

  /** `AudioContext` time of loop iteration 0. */
  get loopStartTime(): number {
    return this.startTime;
  }

  /**
   * Starts the loop. `when` defaults to slightly in the future so the first
   * boundary can be scheduled rather than missed.
   */
  start(loopLengthSec: number, when?: number): number {
    if (loopLengthSec <= 0) {
      throw new Error(`loopLengthSec must be > 0, got ${loopLengthSec}`);
    }
    this.stop();

    this.loopLengthSec = loopLengthSec;
    this.startTime = when ?? this.source.currentTime + TRANSPORT_START_DELAY_SEC;
    this.nextBoundaryTime = this.startTime;
    this.nextIteration = 0;
    this.running = true;

    this.ticker.start(this.lookaheadIntervalMs, () => this.tick());
    // Fire once immediately so the first boundary isn't delayed a full interval.
    this.tick();
    return this.startTime;
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.ticker.stop();
  }

  onBoundary(listener: BoundaryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Seconds elapsed within the current loop iteration; 0 before the loop starts. */
  getCurrentLoopPosition(): number {
    if (!this.running) return 0;
    const elapsed = this.source.currentTime - this.startTime;
    if (elapsed <= 0) return 0;
    return elapsed % this.loopLengthSec;
  }

  /** 0-based iteration currently sounding; -1 before the loop has begun. */
  getCurrentIteration(): number {
    if (!this.running) return -1;
    const elapsed = this.source.currentTime - this.startTime;
    if (elapsed < 0) return -1;
    return Math.floor(elapsed / this.loopLengthSec);
  }

  /**
   * The first loop boundary strictly after `time`. Used to arm a recording so
   * capture lines up with the top of the loop.
   */
  getNextBoundaryAfter(time: number): number {
    if (!this.running) {
      throw new Error('TransportClock is not running');
    }
    if (time < this.startTime) return this.startTime;
    const elapsed = time - this.startTime;
    const iterations = Math.floor(elapsed / this.loopLengthSec) + 1;
    return this.startTime + iterations * this.loopLengthSec;
  }

  /**
   * Emits every boundary that falls inside the lookahead window. Listeners are
   * expected to schedule audio at `boundary.time`, not to play it now.
   */
  private tick(): void {
    if (!this.running) return;
    const horizon = this.source.currentTime + this.scheduleAheadSec;

    while (this.nextBoundaryTime < horizon) {
      const boundary: LoopBoundary = {
        time: this.nextBoundaryTime,
        iteration: this.nextIteration,
      };
      for (const listener of this.listeners) {
        listener(boundary);
      }
      this.nextIteration += 1;
      this.nextBoundaryTime += this.loopLengthSec;
    }
  }
}
