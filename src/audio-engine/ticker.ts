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

export function createTicker(): Ticker {
  return typeof Worker === 'undefined' ? new IntervalTicker() : new WorkerTicker();
}
