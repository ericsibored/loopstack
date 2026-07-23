/**
 * A repeating timer that keeps firing when the tab is backgrounded.
 *
 * Main-thread `setInterval` gets clamped to ~1s (and worse on mobile) once a tab
 * is hidden, which would starve the lookahead scheduler and cause audible gaps.
 * A Worker's timer is not clamped the same way, so the scheduler lives there.
 * The Worker only says "wake up" — all timing math still reads
 * `AudioContext.currentTime` on the main thread.
 */

export interface Ticker {
  start(intervalMs: number, onTick: () => void): void;
  stop(): void;
}

const WORKER_SOURCE = `
let id = null;
self.onmessage = (e) => {
  if (e.data.type === 'start') {
    if (id !== null) clearInterval(id);
    id = setInterval(() => self.postMessage('tick'), e.data.intervalMs);
  } else if (e.data.type === 'stop') {
    if (id !== null) clearInterval(id);
    id = null;
  }
};
`;

export class WorkerTicker implements Ticker {
  private worker: Worker | null = null;
  private url: string | null = null;

  start(intervalMs: number, onTick: () => void): void {
    this.stop();
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    this.url = URL.createObjectURL(blob);
    this.worker = new Worker(this.url);
    this.worker.onmessage = () => onTick();
    this.worker.postMessage({ type: 'start', intervalMs });
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'stop' });
      this.worker.terminate();
      this.worker = null;
    }
    if (this.url) {
      URL.revokeObjectURL(this.url);
      this.url = null;
    }
  }
}

/** Plain `setInterval` ticker — used in tests and as a fallback. */
export class IntervalTicker implements Ticker {
  private id: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number, onTick: () => void): void {
    this.stop();
    this.id = setInterval(onTick, intervalMs);
  }

  stop(): void {
    if (this.id !== null) {
      clearInterval(this.id);
      this.id = null;
    }
  }
}

/** Fires only when driven manually. Lets unit tests step the scheduler. */
export class ManualTicker implements Ticker {
  private onTick: (() => void) | null = null;

  start(_intervalMs: number, onTick: () => void): void {
    this.onTick = onTick;
  }

  stop(): void {
    this.onTick = null;
  }

  tick(): void {
    this.onTick?.();
  }
}

/**
 * Runs a Worker timer and a main-thread timer together.
 *
 * Each covers the other's failure mode. The Worker survives tab backgrounding,
 * where `setInterval` is clamped to ~1s; the interval survives the Worker not
 * running at all, which is what happens if a Content-Security-Policy forbids
 * `blob:` workers. That second case is silent and total — no error, no ticks,
 * and the transport schedules one lookahead window of audio and then goes
 * quiet, which presents as "playback stops after the first few seconds."
 *
 * Double-driving is free: `TransportClock.tick()` only emits boundaries it has
 * not already emitted, so an extra call does nothing.
 */
export class ResilientTicker implements Ticker {
  private readonly worker = new WorkerTicker();
  private readonly interval = new IntervalTicker();
  private workerTicks = 0;

  start(intervalMs: number, onTick: () => void): void {
    this.workerTicks = 0;
    try {
      this.worker.start(intervalMs, () => {
        this.workerTicks++;
        onTick();
      });
    } catch {
      // Worker construction blocked; the interval below carries the load.
    }
    // Slower, because it is a safety net rather than the primary driver. Still
    // well inside the scheduling window, so nothing is missed if it is alone.
    this.interval.start(Math.max(intervalMs, 100), onTick);
  }

  stop(): void {
    this.worker.stop();
    this.interval.stop();
  }

  /** False if the Worker never delivered a tick — surfaced in diagnostics. */
  get workerAlive(): boolean {
    return this.workerTicks > 0;
  }
}

export function createTicker(): Ticker {
  return typeof Worker === 'undefined' ? new IntervalTicker() : new ResilientTicker();
}
