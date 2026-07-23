/**
 * Data model (architecture doc §5).
 *
 * Note on units: every field that carries a duration says so in its name — `Ms`
 * for milliseconds (the unit the UI speaks) and `Sec` for seconds (the unit
 * `AudioContext` speaks). Mixing the two silently is the single easiest way to
 * introduce a timing bug here, so the names are deliberately noisy.
 */

export interface Track {
  id: string;
  order: number;
  buffer: AudioBuffer;
  /** Key into IndexedDB for the stored raw audio. Unused until Phase 3. */
  blobRef: string | null;
  /** Alignment offset. Non-destructive: a scheduling parameter only. */
  offsetMs: number;
  /** 0-1 */
  gain: number;
  /** -1 (left) to 1 (right) */
  pan: number;
  muted: boolean;
  soloed: boolean;
  denoiseApplied: boolean;
  /** `AudioContext.currentTime` at capture start. Kept for drift debugging. */
  recordedAtLoopTime: number;
}

export interface ProjectState {
  id: string;
  loopLengthMs: number;
  /** null in free-length mode (no BPM grid). */
  bpm: number | null;
  tracks: Track[];
  /** Measured round-trip latency from calibration (§6.2). */
  inputLatencyOffsetMs: number;
  createdAt: string;
  updatedAt: string;
}

export type TransportState = 'idle' | 'recording' | 'playing' | 'paused';

/** The subset of a Track that playback scheduling actually reads. */
export interface PlayableTrack {
  id: string;
  buffer: AudioBuffer;
  offsetMs: number;
  gain: number;
  pan: number;
  muted: boolean;
  soloed: boolean;
}

/** A loop boundary the scheduler has committed to. */
export interface LoopBoundary {
  /** `AudioContext` time of the boundary. */
  time: number;
  /** 0-based loop iteration since transport start. */
  iteration: number;
}

export type BoundaryListener = (boundary: LoopBoundary) => void;

/** Raw mono capture straight off the worklet, before any loop trimming. */
export interface CaptureResult {
  samples: Float32Array;
  sampleRate: number;
  /** `AudioContext` time corresponding to `samples[0]`. */
  startTime: number;
}

/**
 * De-noise backends implement this and nothing else, so the model can be swapped
 * without touching callers (§4.5).
 */
export interface DenoiseBackend {
  readonly name: string;
  process(samples: Float32Array, sampleRate: number): Promise<Float32Array>;
  dispose(): void;
}
