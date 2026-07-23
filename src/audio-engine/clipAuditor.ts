/**
 * Solo playback of a single clip, for auditing.
 *
 * Routed straight to the destination rather than through PlaybackManager's bus,
 * so auditing is unaffected by that clip's mute, solo, gain, pan or nudge — the
 * point is to hear what was actually captured, not what the mix is doing to it.
 *
 * While a clip is auditioned the loop bus is ducked rather than stopped. The
 * transport keeps its phase, so playback resumes exactly where it would have
 * been instead of jumping, and there is no re-sync cost on the way back.
 */

export interface AuditionState {
  trackId: string;
  /** AudioContext time the clip started. */
  startTime: number;
  durationSec: number;
  loop: boolean;
}

export class ClipAuditor {
  private readonly ctx: AudioContext;
  private readonly output: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private current: AuditionState | null = null;
  private onChange: (() => void) | null = null;

  constructor(ctx: AudioContext, destination?: AudioNode) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.connect(destination ?? ctx.destination);
  }

  setListener(listener: (() => void) | null): void {
    this.onChange = listener;
  }

  get auditioningTrackId(): string | null {
    return this.current?.trackId ?? null;
  }

  play(trackId: string, buffer: AudioBuffer, loop = false): void {
    this.stop();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(this.output);
    source.onended = () => {
      // A source replaced by a newer audition also fires onended; ignore it, or
      // starting clip B would immediately clear clip B's own state.
      if (this.source === source) {
        this.source = null;
        this.current = null;
        this.onChange?.();
      }
    };
    source.start();

    this.source = source;
    this.current = {
      trackId,
      startTime: this.ctx.currentTime,
      durationSec: buffer.duration,
      loop,
    };
    this.onChange?.();
  }

  stop(): void {
    if (!this.source) return;
    const source = this.source;
    this.source = null;
    this.current = null;
    try {
      source.onended = null;
      source.stop();
    } catch {
      // Already ended — nothing to stop.
    }
    this.onChange?.();
  }

  /** 0-1 through the clip, or null when nothing is being auditioned. */
  getProgress(): number | null {
    if (!this.current) return null;
    const elapsed = this.ctx.currentTime - this.current.startTime;
    if (this.current.durationSec <= 0) return null;
    const ratio = elapsed / this.current.durationSec;
    return this.current.loop ? ratio % 1 : Math.min(1, Math.max(0, ratio));
  }

  dispose(): void {
    this.stop();
    this.output.disconnect();
  }
}
