/**
 * Loop status and mic entry point.
 *
 * Transport actions live in TransportControls at the bottom of the screen —
 * two sets of play/stop controls in one view is worse than none.
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

  if (!micReady) {
    return (
      <section className="rounded-xl border border-edge bg-surface-raised p-3">
        <button
          onClick={() => void projectActions.enableMic()}
          disabled={busy}
          className="h-11 w-full rounded-lg border border-accent bg-accent/10 px-4 text-sm font-medium text-accent disabled:opacity-40"
        >
          {busy ? 'Requesting…' : 'Enable microphone'}
        </button>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-1 rounded-xl border border-edge bg-surface-raised p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{describeState(state)}</span>
        <span className="font-mono text-xs text-ink-dim">
          {loopLengthSec ? `${loopLengthSec.toFixed(2)}s loop` : 'no loop yet'}
        </span>
      </div>
      <p className="text-[11px] text-ink-dim">
        {calibrated
          ? `Calibrated at ${latencyMs.toFixed(1)} ms.`
          : 'Not calibrated — overdubs may land late.'}{' '}
        Noise suppression {constraints.noiseSuppression ? 'on' : 'off'}. Check
        levels on the Input tab.
      </p>
    </section>
  );
}

function describeState(state: string): string {
  switch (state) {
    case 'recording':
      return 'Recording';
    case 'armed':
      return 'Armed';
    case 'counting-in':
      return 'Counting in';
    case 'playing':
      return 'Playing';
    case 'paused':
      return 'Paused';
    case 'stopped':
      return 'Stopped';
    case 'calibrating':
      return 'Calibrating';
    default:
      return 'Ready';
  }
}
