/**
 * The one control that matters. Its label is the app's status display, because
 * in a looper the question "what happens if I press this now" changes with
 * every state and a wrong guess costs you a take.
 */

import { projectActions, useProjectStore } from '../../store/projectStore';

export function RecordButton() {
  const state = useProjectStore((s) => s.state);
  const canRecord = useProjectStore((s) => s.canRecord);
  const micReady = useProjectStore((s) => s.micReady);
  const busy = useProjectStore((s) => s.busy);
  const loopLengthSec = useProjectStore((s) => s.loopLengthSec);

  const isFirstTake = loopLengthSec === null;
  const disabled =
    busy || !micReady || state === 'calibrating' || (!canRecord && state === 'playing');

  const { label, hint, tone } = describe(state, isFirstTake, canRecord);

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => void projectActions.toggleRecord()}
        disabled={disabled}
        aria-label={label}
        className={`flex size-32 items-center justify-center rounded-full border-4 text-lg font-semibold transition-transform active:scale-95 disabled:opacity-40 ${tone}`}
      >
        {label}
      </button>
      <p className="h-4 text-xs text-ink-dim">{micReady ? hint : 'Enable the mic to start'}</p>
    </div>
  );
}

function describe(
  state: string,
  isFirstTake: boolean,
  canRecord: boolean,
): { label: string; hint: string; tone: string } {
  switch (state) {
    case 'recording':
      return isFirstTake
        ? {
            label: 'Stop',
            hint: 'Recording — stopping sets the loop length',
            tone: 'border-record bg-record/20 text-ink animate-pulse',
          }
        : {
            label: 'Cancel',
            hint: 'Overdubbing — stops on its own at the end of the loop',
            tone: 'border-record bg-record/20 text-ink animate-pulse',
          };
    case 'armed':
      return {
        label: 'Armed',
        hint: 'Waiting for the top of the loop',
        tone: 'border-accent bg-accent/10 text-accent',
      };
    case 'counting-in':
      return {
        label: 'Count-in',
        hint: 'Recording starts on the downbeat',
        tone: 'border-accent bg-accent/10 text-accent animate-pulse',
      };
    case 'calibrating':
      return {
        label: '…',
        hint: 'Calibrating latency',
        tone: 'border-edge text-ink-dim',
      };
    default:
      return {
        label: 'Record',
        hint: isFirstTake
          ? 'First take sets the loop length'
          : canRecord
            ? 'Overdub starts at the next loop'
            : 'Layer limit reached',
        tone: 'border-record bg-record/10 text-ink hover:bg-record/20',
      };
  }
}
