/**
 * BPM, metronome and count-in (§8.3).
 *
 * BPM is optional — free-length mode is the default, because forcing a tempo
 * decision before the first take is exactly the friction a looper is supposed
 * to avoid. Setting it unlocks the metronome, count-in, snap-to-beat, and
 * rounding the first take's loop length to whole beats.
 */

import { projectActions, useProjectStore } from '../../store/projectStore';

const COUNT_IN_OPTIONS = [0, 2, 4];
const MIN_BPM = 40;
const MAX_BPM = 240;

export function GridBar() {
  const bpm = useProjectStore((s) => s.bpm);
  const metronomeEnabled = useProjectStore((s) => s.metronomeEnabled);
  const countInBeats = useProjectStore((s) => s.countInBeats);
  const loopLengthSec = useProjectStore((s) => s.loopLengthSec);

  const gridOn = bpm !== null;
  // Changing tempo after the loop exists would move the grid out from under
  // audio that is already committed to a fixed length.
  const locked = loopLengthSec !== null;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-edge bg-surface-raised p-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => projectActions.setBpm(gridOn ? null : 100)}
          disabled={locked}
          aria-pressed={gridOn}
          className={`h-9 rounded-lg border px-3 text-xs disabled:opacity-40 ${
            gridOn ? 'border-accent bg-accent text-surface' : 'border-edge text-ink-dim'
          }`}
        >
          {gridOn ? 'Grid on' : 'Free length'}
        </button>

        {/* The metronome lives behind this toggle, so say so — otherwise there
            is nothing on screen to suggest the app has one at all. */}
        {!gridOn && (
          <span className="text-xs text-ink-dim">
            Turn on for metronome, count-in &amp; snap-to-beat
          </span>
        )}

        {gridOn && (
          <>
            <input
              type="range"
              min={MIN_BPM}
              max={MAX_BPM}
              step={1}
              value={bpm}
              disabled={locked}
              onChange={(e) => projectActions.setBpm(Number(e.target.value))}
              aria-label="Tempo in BPM"
              className="h-9 flex-1 accent-[oklch(0.82_0.15_175)] disabled:opacity-40"
            />
            <span className="w-16 text-right font-mono text-xs text-ink-dim">{bpm} BPM</span>
          </>
        )}
      </div>

      {gridOn && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => projectActions.setMetronome(!metronomeEnabled)}
            aria-pressed={metronomeEnabled}
            className={`h-9 rounded-lg border px-3 text-xs ${
              metronomeEnabled ? 'border-accent bg-accent text-surface' : 'border-edge text-ink-dim'
            }`}
          >
            Metronome
          </button>

          <span className="text-xs text-ink-dim">Count-in</span>
          <div className="flex gap-1" role="group" aria-label="Count-in beats">
            {COUNT_IN_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => projectActions.setCountInBeats(n)}
                aria-pressed={countInBeats === n}
                className={`h-9 min-w-9 rounded-lg border px-2 text-xs ${
                  countInBeats === n
                    ? 'border-accent bg-accent text-surface'
                    : 'border-edge text-ink-dim'
                }`}
              >
                {n === 0 ? 'off' : n}
              </button>
            ))}
          </div>
        </div>
      )}

      {locked && gridOn && (
        <p className="text-[11px] text-ink-dim">
          Tempo is locked while a loop exists — delete all layers to change it.
        </p>
      )}
    </section>
  );
}
