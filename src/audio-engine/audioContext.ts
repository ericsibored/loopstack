/**
 * AudioContext lifecycle.
 *
 * iOS Safari refuses to start an AudioContext outside a user gesture, and will
 * silently suspend it again when the tab backgrounds. Every entry point into
 * the engine therefore goes through `resumeAudioContext()` from inside a click
 * handler rather than assuming the context is running.
 */

let context: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!context) {
    context = new AudioContext({ latencyHint: 'interactive' });
  }
  return context;
}

/** Must be called from within a user gesture on iOS Safari. */
export async function resumeAudioContext(): Promise<AudioContext> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  return ctx;
}

export async function closeAudioContext(): Promise<void> {
  if (context) {
    await context.close();
    context = null;
  }
}

/**
 * The context's own reported output latency, where the browser provides it.
 * This is *not* a substitute for the measured round-trip calibration (§6.2) —
 * it omits the input path and the speaker→mic acoustic delay — but it is a
 * useful sanity check against the measured value.
 */
export function getReportedLatency(ctx: AudioContext): {
  baseLatencySec: number;
  outputLatencySec: number;
} {
  return {
    baseLatencySec: ctx.baseLatency ?? 0,
    outputLatencySec: ctx.outputLatency ?? 0,
  };
}
