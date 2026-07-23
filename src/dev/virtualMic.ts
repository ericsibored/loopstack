/**
 * A synthetic microphone for development.
 *
 * `createMediaStreamDestination()` produces a genuine MediaStream, so feeding
 * it to RecordingManager exercises the real capture path end to end — the
 * worklet, the capture-start timestamp, the loop slice, overdub arming — on a
 * machine with no microphone, and with hits at times we know exactly. That
 * makes capture accuracy *measurable* rather than a matter of listening.
 *
 * It does not replace testing on a real device: it has no acoustic round trip,
 * no driver latency and no room. Those are precisely what calibration exists to
 * measure, and they only show up on real hardware.
 *
 * Dev-only. Loaded via a dynamic import in main.tsx so it never enters the
 * production bundle.
 */

import { getEngine } from '../audio-engine/engine';

const CLICK_SEC = 0.03;

export class VirtualMic {
  private readonly ctx: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly bus: GainNode;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.destination = ctx.createMediaStreamDestination();
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;
    // Deliberately not connected to ctx.destination — this is an input, and
    // routing it to the speakers would feed it back into a real mic.
    this.bus.connect(this.destination);
  }

  get stream(): MediaStream {
    return this.destination.stream;
  }

  /** A short blip at a precise AudioContext time. */
  clickAt(when: number, frequency = 900): void {
    const at = Math.max(when, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    const envelope = this.ctx.createGain();
    osc.frequency.value = frequency;
    osc.connect(envelope);
    envelope.connect(this.bus);

    envelope.gain.setValueAtTime(0.8, at);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + CLICK_SEC);
    osc.start(at);
    osc.stop(at + CLICK_SEC);
  }

  /** Schedules `count` evenly spaced clicks, accenting the first. */
  patternAt(startTime: number, count: number, intervalSec: number): void {
    for (let i = 0; i < count; i++) {
      this.clickAt(startTime + i * intervalSec, i === 0 ? 1400 : 900);
    }
  }

  dispose(): void {
    this.bus.disconnect();
    this.destination.stream.getTracks().forEach((t) => t.stop());
  }
}

declare global {
  interface Window {
    __virtualMic?: {
      enable(): Promise<VirtualMic>;
      mic: VirtualMic | null;
    };
  }
}

export function install(): void {
  const state: { mic: VirtualMic | null } = { mic: null };

  window.__virtualMic = {
    mic: null,
    async enable() {
      const engine = getEngine();
      await engine.unlock();
      if (!state.mic) state.mic = new VirtualMic(engine.ctx);
      await engine.recording.attachStream(state.mic.stream);
      window.__virtualMic!.mic = state.mic;
      return state.mic;
    },
  };
}
