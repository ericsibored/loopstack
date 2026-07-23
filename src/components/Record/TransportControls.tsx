/**
 * The four primary actions: Record, Pause, Stop, Delete.
 *
 * Record is deliberately the largest and the only coloured one — during a
 * performance it is the control being hit repeatedly, often without looking.
 * Its label doubles as the status display, because in a looper the question
 * "what happens if I press this now" changes with every state and a wrong guess
 * costs a take.
 *
 * Delete asks for a second tap rather than opening a dialog: it is destructive
 * and undoable only by re-recording, but a modal in the middle of playing is
 * worse than a confirm-in-place.
 */

import { useEffect, useState } from 'react';
import { projectActions, useProjectStore } from '../../store/projectStore';

export function TransportControls() {
  const state = useProjectStore((s) => s.state);
  const canRecord = useProjectStore((s) => s.canRecord);
  const micReady = useProjectStore((s) => s.micReady);
  const busy = useProjectStore((s) => s.busy);
  const loopLengthSec = useProjectStore((s) => s.loopLengthSec);
  const trackCount = useProjectStore((s) => s.tracks.length);

  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Don't leave the confirm armed indefinitely — a stray tap later would wipe
  // the session.
  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  const isRecording = state === 'recording' || state === 'armed' || state === 'counting-in';
  const isPlaying = state === 'playing' || isRecording;
  const hasLoop = loopLengthSec !== null;

  const record = describeRecord(state, !hasLoop, canRecord);
  const recordDisabled =
    busy || !micReady || state === 'calibrating' || (!canRecord && !isRecording);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex w-full items-center justify-center gap-2">
        <button
          onClick={() => void projectActions.toggleRecord()}
          disabled={recordDisabled}
          aria-label={record.label}
          className={`flex h-16 flex-1 items-center justify-center rounded-xl border-2 text-base font-semibold transition-transform active:scale-95 disabled:opacity-40 ${record.tone}`}
        >
          {record.label}
        </button>

        <button
          onClick={() => (state === 'paused' ? projectActions.play() : projectActions.pause())}
          disabled={!hasLoop || isRecording || (!isPlaying && state !== 'paused')}
          aria-label={state === 'paused' ? 'Resume' : 'Pause'}
          className="h-16 w-16 rounded-xl border border-edge text-sm text-ink disabled:opacity-30"
        >
          {state === 'paused' ? '▶' : '❚❚'}
        </button>

        <button
          onClick={() => projectActions.stop()}
          disabled={!hasLoop || (!isPlaying && state !== 'paused')}
          aria-label="Stop"
          className="h-16 w-16 rounded-xl border border-edge text-sm text-ink disabled:opacity-30"
        >
          ■
        </button>

        <button
          onClick={() => {
            if (confirmingDelete) {
              projectActions.clearAll();
              setConfirmingDelete(false);
            } else {
              setConfirmingDelete(true);
            }
          }}
          disabled={trackCount === 0}
          aria-label={confirmingDelete ? 'Confirm delete all layers' : 'Delete all layers'}
          className={`h-16 w-16 rounded-xl border text-xs disabled:opacity-30 ${
            confirmingDelete
              ? 'border-red-500 bg-red-500/20 text-red-200'
              : 'border-edge text-ink-dim'
          }`}
        >
          {confirmingDelete ? 'Sure?' : '🗑'}
        </button>
      </div>

      <p className="h-4 text-center text-xs text-ink-dim">
        {!micReady
          ? 'Enable the mic to start'
          : confirmingDelete
            ? `Tap again to delete all ${trackCount} layer${trackCount === 1 ? '' : 's'}`
            : state === 'paused'
              ? 'Paused — resume picks up where you left off'
              : record.hint}
      </p>
    </div>
  );
}

function describeRecord(
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
            tone: 'border-record bg-record/25 text-ink animate-pulse',
          }
        : {
            label: 'Cancel',
            hint: 'Overdubbing — stops on its own at the end of the loop',
            tone: 'border-record bg-record/25 text-ink animate-pulse',
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
      return { label: '…', hint: 'Calibrating latency', tone: 'border-edge text-ink-dim' };
    default:
      return {
        label: '● Record',
        hint: isFirstTake
          ? 'First take sets the loop length'
          : canRecord
            ? 'Overdub starts at the next loop'
            : 'Layer limit reached',
        tone: 'border-record bg-record/10 text-ink',
      };
  }
}
