/**
 * One layer: waveform, mute/solo, reorder, gain/pan, nudge, auto-align and
 * de-noise.
 *
 * The mixing controls are collapsed behind a disclosure by default. A looper is
 * used mid-performance, and the controls that must be reachable in one tap
 * (mute, solo, record) should not be competing for space with the ones you use
 * while sitting still.
 */

import { useState } from 'react';
import { engine, projectActions, useProjectStore } from '../../store/projectStore';
import type { TrackSnapshot } from '../../audio-engine/loopController';
import { Waveform } from '../Waveform/Waveform';

const NUDGE_STEP_MS = 5;
/** Below this correlation, a suggestion is more likely noise than alignment. */
const LOW_CONFIDENCE = 0.4;

interface TrackRowProps {
  track: TrackSnapshot;
  isFirst: boolean;
  isLast: boolean;
}

export function TrackRow({ track, isFirst, isLast }: TrackRowProps) {
  const loopLengthSec = useProjectStore((s) => s.loopLengthSec);
  const transportState = useProjectStore((s) => s.state);
  const bpm = useProjectStore((s) => s.bpm);
  const trackCount = useProjectStore((s) => s.tracks.length);
  const auditioningTrackId = useProjectStore((s) => s.auditioningTrackId);
  const [open, setOpen] = useState(false);

  const auditioning = auditioningTrackId === track.id;

  // Read straight from the clock each frame rather than through the store —
  // a playhead at 60fps must never go through React state.
  const getProgress = () => {
    // While auditioning, the playhead should follow the clip being previewed,
    // not the loop it is muted behind.
    if (auditioning) return engine.controller.getAuditionProgress();
    if (transportState === 'stopped' || transportState === 'idle') return null;
    if (!loopLengthSec) return null;
    return engine.controller.getLoopPosition() / loopLengthSec;
  };

  return (
    <li className="rounded-xl border border-edge bg-surface-raised p-3">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex flex-col">
          <button
            onClick={() => projectActions.moveTrack(track.id, -1)}
            disabled={isFirst}
            aria-label={`Move ${track.label} up`}
            className="h-5 px-1 text-xs text-ink-dim disabled:opacity-25"
          >
            ▲
          </button>
          <button
            onClick={() => projectActions.moveTrack(track.id, 1)}
            disabled={isLast}
            aria-label={`Move ${track.label} down`}
            className="h-5 px-1 text-xs text-ink-dim disabled:opacity-25"
          >
            ▼
          </button>
        </div>

        <button
          onClick={() => projectActions.auditionTrack(track.id)}
          aria-pressed={auditioning}
          aria-label={`${auditioning ? 'Stop' : 'Play'} ${track.label} on its own`}
          title="Play this clip on its own"
          className={`size-9 rounded-lg border text-xs ${
            auditioning ? 'border-amber-400 bg-amber-400 text-surface' : 'border-edge text-ink-dim'
          }`}
        >
          {auditioning ? '■' : '▶'}
        </button>

        <div className="flex flex-1 flex-col leading-tight">
          <span className="text-sm font-medium">{track.label}</span>
          <span className="font-mono text-[10px] text-ink-dim">{formatPeak(track.peakDb)}</span>
        </div>

        {track.denoise === 'applied' && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">NR</span>
        )}

        <button
          onClick={() => projectActions.setMuted(track.id, !track.muted)}
          aria-pressed={track.muted}
          className={`size-9 rounded-lg border text-xs font-semibold ${
            track.muted ? 'border-ink bg-ink text-surface' : 'border-edge text-ink-dim'
          }`}
        >
          M
        </button>
        <button
          onClick={() => projectActions.setSoloed(track.id, !track.soloed)}
          aria-pressed={track.soloed}
          className={`size-9 rounded-lg border text-xs font-semibold ${
            track.soloed ? 'border-accent bg-accent text-surface' : 'border-edge text-ink-dim'
          }`}
        >
          S
        </button>
        {/* Delete stays in the header rather than behind the disclosure:
            discarding a take you are unhappy with is a first-class action, not
            an advanced one. */}
        <button
          onClick={() => projectActions.removeTrack(track.id)}
          aria-label={`Delete ${track.label}`}
          title="Delete this layer"
          className="size-9 rounded-lg border border-edge text-xs text-ink-dim hover:border-red-500/60 hover:text-red-300"
        >
          ✕
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} controls for ${track.label}`}
          className="size-9 rounded-lg border border-edge text-xs text-ink-dim"
        >
          {open ? '▴' : '▾'}
        </button>
      </div>

      <Waveform
        peaks={track.peaks}
        getProgress={getProgress}
        muted={track.muted}
        offsetMs={track.offsetMs}
        loopLengthSec={loopLengthSec}
        auditioning={auditioning}
      />

      {open && (
        <div className="mt-2 flex flex-col gap-3 border-t border-edge pt-3">
          <Slider
            label="Gain"
            value={track.gain}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(track.gain * 100)}%`}
            onChange={(v) => projectActions.setGain(track.id, v)}
          />
          <Slider
            label="Pan"
            value={track.pan}
            min={-1}
            max={1}
            step={0.05}
            display={panLabel(track.pan)}
            onChange={(v) => projectActions.setPan(track.id, v)}
          />

          <div className="flex items-center gap-2">
            <span className="w-10 text-xs text-ink-dim">Nudge</span>
            <button
              onClick={() => projectActions.nudge(track.id, -NUDGE_STEP_MS)}
              aria-label={`Nudge ${track.label} earlier`}
              className="h-9 rounded-lg border border-edge px-3 text-sm"
            >
              −
            </button>
            <button
              onClick={() => projectActions.resetNudge(track.id)}
              className="h-9 min-w-20 rounded-lg border border-edge px-2 font-mono text-xs text-ink-dim"
              title="Reset to zero"
            >
              {track.offsetMs > 0 ? '+' : ''}
              {track.offsetMs.toFixed(0)} ms
            </button>
            <button
              onClick={() => projectActions.nudge(track.id, NUDGE_STEP_MS)}
              aria-label={`Nudge ${track.label} later`}
              className="h-9 rounded-lg border border-edge px-3 text-sm"
            >
              +
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void projectActions.requestAlignment(track.id)}
              disabled={trackCount < 2}
              className="h-9 rounded-lg border border-edge px-3 text-xs disabled:opacity-40"
              title={trackCount < 2 ? 'Needs another layer to align against' : undefined}
            >
              Auto-align
            </button>
            <button
              onClick={() => projectActions.snapToGrid(track.id)}
              disabled={bpm === null}
              className="h-9 rounded-lg border border-edge px-3 text-xs disabled:opacity-40"
              title={bpm === null ? 'Set a BPM first' : undefined}
            >
              Snap to beat
            </button>
            <DenoiseControls track={track} />
          </div>

          {track.alignSuggestionMs !== null && (
            <AlignSuggestion track={track} />
          )}

        </div>
      )}
    </li>
  );
}

function AlignSuggestion({ track }: { track: TrackSnapshot }) {
  const confidence = track.alignConfidence ?? 0;
  const weak = confidence < LOW_CONFIDENCE;

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 p-2">
      <p className="text-xs">
        Move to{' '}
        <span className="font-mono">
          {track.alignSuggestionMs! > 0 ? '+' : ''}
          {track.alignSuggestionMs!.toFixed(1)} ms
        </span>{' '}
        <span className={weak ? 'text-amber-400' : 'text-ink-dim'}>
          (confidence {confidence.toFixed(2)}
          {weak ? ' — low, check by ear' : ''})
        </span>
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => projectActions.acceptAlignment(track.id)}
          className="h-9 rounded-lg border border-accent bg-accent px-3 text-xs font-medium text-surface"
        >
          Apply
        </button>
        <button
          onClick={() => projectActions.rejectAlignment(track.id)}
          className="h-9 rounded-lg border border-edge px-3 text-xs"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function DenoiseControls({ track }: { track: TrackSnapshot }) {
  if (track.denoise === 'processing') {
    return <span className="self-center text-xs text-ink-dim">De-noising…</span>;
  }

  if (track.denoise === 'previewing-raw' || track.denoise === 'previewing-processed') {
    const showingProcessed = track.denoise === 'previewing-processed';
    return (
      <div className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
        <button
          onClick={() => projectActions.toggleDenoisePreview(track.id)}
          className="h-9 rounded-lg border border-edge px-3 text-xs"
        >
          Hearing: {showingProcessed ? 'de-noised' : 'original'} — switch
        </button>
        <button
          onClick={() => projectActions.commitDenoise(track.id, true)}
          className="h-9 rounded-lg border border-accent bg-accent px-3 text-xs font-medium text-surface"
        >
          Keep
        </button>
        <button
          onClick={() => projectActions.commitDenoise(track.id, false)}
          className="h-9 rounded-lg border border-edge px-3 text-xs"
        >
          Discard
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => void projectActions.runDenoise(track.id)}
      className="h-9 rounded-lg border border-edge px-3 text-xs"
    >
      {track.denoise === 'applied' ? 'De-noise again' : 'De-noise'}
    </button>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-xs text-ink-dim">
      <span className="w-10">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 flex-1 accent-[oklch(0.82_0.15_175)]"
      />
      <span className="w-12 text-right font-mono">{display}</span>
    </label>
  );
}

/**
 * The waveform is normalised for visibility, so this number is the only place
 * the clip's real level is visible. Quiet and clipped takes are both worth
 * catching before you build three more layers on top of them.
 */
function formatPeak(peakDb: number): string {
  if (!Number.isFinite(peakDb)) return 'silent';
  if (peakDb >= -0.1) return `peak ${peakDb.toFixed(1)} dB · clipped`;
  if (peakDb < -40) return `peak ${peakDb.toFixed(1)} dB · very quiet`;
  return `peak ${peakDb.toFixed(1)} dB`;
}

function panLabel(pan: number): string {
  if (Math.abs(pan) < 0.02) return 'C';
  const side = pan < 0 ? 'L' : 'R';
  return `${side}${Math.round(Math.abs(pan) * 100)}`;
}
