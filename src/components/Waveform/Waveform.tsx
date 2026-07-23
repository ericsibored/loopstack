/**
 * Peak waveform with a live playhead.
 *
 * Drawn on canvas rather than as SVG/DOM: with four layers redrawing a playhead
 * every frame, canvas keeps this off React's render path entirely. The
 * component re-renders only when the peaks themselves change.
 *
 * Amplitude is normalised to the clip's own peak. Drawn at true amplitude, a
 * take recorded at a perfectly normal -30 dBFS produces a one-pixel line that
 * reads as an empty lane — which is useless for the thing waveforms are for,
 * namely seeing where the hits are. The true level is shown as a number beside
 * the waveform instead (see TrackRow), so normalising costs no information.
 */

import { useEffect, useRef } from 'react';

interface WaveformProps {
  peaks: Float32Array;
  /** 0-1 within the loop, or null when the transport is stopped. */
  getProgress: () => number | null;
  muted: boolean;
  /** Nudge offset, drawn as a shift so alignment changes are visible. */
  offsetMs: number;
  loopLengthSec: number | null;
  /** Highlights the lane while this clip is being auditioned on its own. */
  auditioning?: boolean;
}

/**
 * Clips quieter than this are drawn at true scale rather than normalised.
 * Amplifying near-silence would turn the noise floor into a convincing-looking
 * waveform, which is worse than showing an empty lane honestly.
 */
const SILENCE_FLOOR = 0.002;

export function Waveform({
  peaks,
  getProgress,
  muted,
  offsetMs,
  loopLengthSec,
  auditioning = false,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Held in refs so the animation loop reads current values without being torn
  // down and restarted on every prop change.
  const stateRef = useRef({ peaks, getProgress, muted, offsetMs, loopLengthSec, auditioning });
  stateRef.current = { peaks, getProgress, muted, offsetMs, loopLengthSec, auditioning };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      const s = stateRef.current;
      if (canvas.getBoundingClientRect().width !== width) resize();

      context.clearRect(0, 0, width, height);

      const mid = height / 2;
      const count = s.peaks.length;
      const barWidth = width / count;
      const shift =
        s.loopLengthSec && s.loopLengthSec > 0
          ? (s.offsetMs / 1000 / s.loopLengthSec) * width
          : 0;

      let max = 0;
      for (let i = 0; i < count; i++) if (s.peaks[i] > max) max = s.peaks[i];
      const scale = max > SILENCE_FLOOR ? 1 / max : 1;

      context.fillStyle = s.muted
        ? 'oklch(0.45 0.02 265)'
        : s.auditioning
          ? 'oklch(0.9 0.16 95)'
          : 'oklch(0.82 0.15 175)';

      for (let i = 0; i < count; i++) {
        const amplitude = Math.min(1, s.peaks[i] * scale);
        const barHeight = Math.max(1, amplitude * (height - 4));
        context.fillRect(
          i * barWidth + shift,
          mid - barHeight / 2,
          Math.max(1, barWidth - 0.5),
          barHeight,
        );
      }

      const progress = s.getProgress();
      if (progress !== null) {
        context.fillStyle = 'oklch(0.97 0 0)';
        context.fillRect(progress * width, 0, 2, height);
      }

      frame = requestAnimationFrame(draw);
    };

    // Paint once synchronously rather than waiting on the first animation
    // frame: rAF does not fire in a backgrounded or non-compositing tab, and a
    // waveform that only appears once the tab is focused looks broken.
    resize();
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className="h-14 w-full" aria-hidden="true" />;
}
