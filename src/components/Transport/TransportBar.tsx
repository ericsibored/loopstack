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

      {/* Mic settings, levels and calibration all live on the Input tab now.
          Their state is summarised here so a problem is visible from the tab
          you actually record on. */}
      {micReady && (
        <p className="text-[11px] text-ink-dim">
          {calibrated
            ? `Calibrated at ${latencyMs.toFixed(1)} ms.`
            : 'Not calibrated — overdubs may land late.'}{' '}
          Noise suppression {constraints.noiseSuppression ? 'on' : 'off'}. Check
          levels on the Input tab.
        </p>
      )}
    </section>
  );
}
