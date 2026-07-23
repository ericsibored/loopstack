/**
 * MixdownRenderer (§4.6) — renders the active tracks to a single buffer via
 * OfflineAudioContext, then encodes WAV.
 *
 * The render deliberately mirrors PlaybackManager's scheduling rather than
 * concatenating buffers: same per-iteration source nodes, same offset handling,
 * same gain/pan chain. If the two ever diverge, the exported file stops
 * matching what the user heard, which is the worst possible export bug.
 */

import type { PlayableTrack } from './types';
import { audioBufferToWav } from './wav';

export interface MixdownOptions {
  tracks: PlayableTrack[];
  loopLengthSec: number;
  /** How many loop repeats to render. */
  repeats: number;
  sampleRate: number;
  /**
   * Extra time rendered past the last loop so a track with a positive offset
   * (or a buffer slightly longer than the loop) isn't cut off mid-tail.
   */
  tailSec?: number;
}

const DEFAULT_TAIL_SEC = 0.5;

export function isAudible(track: PlayableTrack, tracks: PlayableTrack[]): boolean {
  if (track.muted) return false;
  const hasSolo = tracks.some((t) => t.soloed);
  return hasSolo ? track.soloed : true;
}

/** Renders the mix. Stereo out, because per-track pan needs somewhere to go. */
export async function renderMixdown(options: MixdownOptions): Promise<AudioBuffer> {
  const { tracks, loopLengthSec, repeats, sampleRate, tailSec = DEFAULT_TAIL_SEC } = options;

  if (repeats < 1) throw new Error(`repeats must be >= 1, got ${repeats}`);
  if (loopLengthSec <= 0) throw new Error(`loopLengthSec must be > 0, got ${loopLengthSec}`);

  const audible = tracks.filter((t) => isAudible(t, tracks));
  const durationSec = loopLengthSec * repeats + tailSec;
  const frames = Math.ceil(durationSec * sampleRate);

  const ctx = new OfflineAudioContext(2, frames, sampleRate);

  for (const track of audible) {
    const gainNode = ctx.createGain();
    gainNode.gain.value = track.gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = track.pan;
    gainNode.connect(panner);
    panner.connect(ctx.destination);

    for (let iteration = 0; iteration < repeats; iteration++) {
      const source = ctx.createBufferSource();
      source.buffer = track.buffer;
      source.connect(gainNode);

      const start = iteration * loopLengthSec + track.offsetMs / 1000;
      if (start >= 0) {
        source.start(start);
      } else {
        // Negative offset on the first iteration would start before zero;
        // skip into the buffer instead, exactly as PlaybackManager does.
        const skip = -start;
        if (skip < track.buffer.duration) source.start(0, skip);
      }
    }
  }

  return ctx.startRendering();
}

export async function renderMixdownToWav(options: MixdownOptions): Promise<Blob> {
  const rendered = await renderMixdown(options);
  return audioBufferToWav(rendered);
}

/** Triggers a browser download. Kept separate so the render stays testable. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
