/**
 * Crop controls for the selected layer.
 *
 * Two range sliders rather than draggable handles on the canvas: this is a
 * phone-first app, and a 4px hit target you have to grab precisely is far worse
 * on touch than two sliders you can drag anywhere along. The waveform above
 * dims the cropped-out regions, so the sliders still read as direct
 * manipulation of the picture.
 *
 * Trimming is non-destructive and preserves timing — cropping the head of a
 * clip silences it without dragging the rest of the take earlier.
 */

import type { TrackSnapshot } from '../../audio-engine/loopController';
import { projectActions } from '../../store/projectStore';

const NUDGE_SEC = 0.01;

export function TrimEditor({ track }: { track: TrackSnapshot }) {
  const { id, durationSec, trimStartSec, trimEndSec } = track;
  const keptSec = Math.max(0, trimEndSec - trimStartSec);
  const trimmed = trimStartSec > 0.001 || trimEndSec < durationSec - 0.001;

  const setStart = (value: number) => projectActions.setTrim(id, value, trimEndSec);
  const setEnd = (value: number) => projectActions.setTrim(id, trimStartSec, value);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium">Trim</span>
        <span className="font-mono text-[11px] text-ink-dim">
          {keptSec.toFixed(2)}s of {durationSec.toFixed(2)}s
        </span>
      </div>

      <SliderRow
        label="Start"
        value={trimStartSec}
        min={0}
        max={durationSec}
        onChange={setStart}
        onNudge={(delta) => setStart(trimStartSec + delta)}
      />
      <SliderRow
        label="End"
        value={trimEndSec}
        min={0}
        max={durationSec}
        onChange={setEnd}
        onNudge={(delta) => setEnd(trimEndSec + delta)}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={() => projectActions.resetTrim(id)}
          disabled={!trimmed}
          className="h-9 rounded-lg border border-edge px-3 text-xs text-ink-dim disabled:opacity-40"
        >
          Reset trim
        </button>
        <button
          onClick={() => projectActions.auditionTrack(id)}
          className="h-9 rounded-lg border border-edge px-3 text-xs text-ink-dim"
          title="Hear this layer on its own"
        >
          ▶ Preview
        </button>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  onNudge,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[11px] text-ink-dim">{label}</span>
      <button
        onClick={() => onNudge(-NUDGE_SEC)}
        aria-label={`${label} earlier`}
        className="h-8 w-8 rounded-lg border border-edge text-xs text-ink-dim"
      >
        −
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={0.005}
        value={value}
        aria-label={`Trim ${label.toLowerCase()}`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 flex-1 accent-[oklch(0.82_0.15_175)]"
      />
      <button
        onClick={() => onNudge(NUDGE_SEC)}
        aria-label={`${label} later`}
        className="h-8 w-8 rounded-lg border border-edge text-xs text-ink-dim"
      >
        +
      </button>
      <span className="w-12 text-right font-mono text-[11px] text-ink-dim">
        {value.toFixed(2)}s
      </span>
    </div>
  );
}
