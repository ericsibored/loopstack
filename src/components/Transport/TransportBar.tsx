/**
 * Transport, mic setup and latency calibration.
 *
 * Calibration is surfaced here rather than buried in settings because it is the
 * difference between overdubs that line up on their own and overdubs the user
 * has to nudge by hand every time.
 */

import { projectActions, useProjectStore } from '../../store/projectStore';

export function TransportBar() {
  const state = useProjectStore((s) => s.state);
  const micReady = useProjectStore((s) => s.micReady);
  const busy = useProjectStore((s) => s.busy);
  const constraints = useProjectStore((s) => s.micConstraints);
  const loopLengthSec = useProjectStore((s) => s.loopLengthSec);
  const calibrated = useProjectStore((s) => s.calibrated);
  const latencyMs = useProjectStore((s) => s.inputLatencyOffsetMs);

  const playing = state === 'playing' || state === 'recording' || state === 'armed';
  const calibrating = state === 'calibrating';

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-edge bg-surface-raised p-3">
      <div className="flex items-center gap-2">
        {!micReady ? (
          <button
            onClick={() => void projectActions.enableMic()}
            disabled={busy}
            className="h-11 flex-1 rounded-lg border border-accent bg-accent/10 px-4 text-sm font-medium text-accent disabled:opacity-40"
          >
            {busy ? 'Requesting…' : 'Enable microphone'}
          </button>
        ) : (
          <>
            <button
              onClick={() => (playing ? projectActions.stop() : projectActions.play())}
              disabled={loopLengthSec === null || calibrating}
              className="h-11 flex-1 rounded-lg border border-edge px-4 text-sm font-medium disabled:opacity-40"
            >
              {playing ? '■ Stop' : '▶ Play'}
            </button>
            <span className="font-mono text-xs text-ink-dim">
              {loopLengthSec ? `${loopLengthSec.toFixed(2)}s loop` : 'no loop yet'}
            </span>
          </>
        )}
      </div>

      {micReady && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void projectActions.calibrate()}
            disabled={busy || calibrating}
            className={`h-9 rounded-lg border px-3 text-xs disabled:opacity-40 ${
              calibrated ? 'border-edge text-ink-dim' : 'border-accent text-accent'
            }`}
          >
            {calibrating ? 'Listening…' : calibrated ? 'Re-calibrate' : 'Calibrate latency'}
          </button>
          <span className="font-mono text-xs text-ink-dim">
            {calibrated ? `${latencyMs.toFixed(1)}ms round trip` : 'not calibrated'}
          </span>
        </div>
      )}

      <label className="flex items-center gap-2 text-xs text-ink-dim">
        <input
          type="checkbox"
          checked={constraints.noiseSuppression}
          disabled={busy}
          onChange={(e) => void projectActions.setConstraint('noiseSuppression', e.target.checked)}
          className="size-4 accent-[oklch(0.82_0.15_175)]"
        />
        Noise suppression
        {micReady && <span className="text-ink-dim/60">(re-acquires the mic)</span>}
      </label>
    </section>
  );
}
