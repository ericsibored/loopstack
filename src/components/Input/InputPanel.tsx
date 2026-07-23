/**
 * Input tab — check the mic is set up correctly before recording anything.
 *
 * The meter is rAF-driven and reads the analyser directly, never through the
 * store: pushing 60 level updates a second through React state would re-render
 * the whole tree for a number that only one element displays.
 */

import { useEffect, useRef, useState } from 'react';
import {
  InputMonitor,
  dbToMeterPosition,
  judgeLevel,
  type LevelVerdict,
} from '../../audio-engine/inputMonitor';
import type { MicConstraints } from '../../audio-engine/recordingManager';
import { engine, projectActions, useProjectStore } from '../../store/projectStore';
import { Diagnostics } from './Diagnostics';

const CONSTRAINT_COPY: Record<keyof MicConstraints, { label: string; hint: string }> = {
  echoCancellation: {
    label: 'Echo cancellation',
    hint: 'Reduces loop bleed when playing through speakers. Turn off if using headphones — it can thin out the sound.',
  },
  noiseSuppression: {
    label: 'Noise suppression',
    hint: 'Browser-native. Helps on voice, can dull sustained instrument tone.',
  },
  autoGainControl: {
    label: 'Auto gain control',
    hint: 'Off by default: it changes level mid-take, which makes layers inconsistent.',
  },
};

const VERDICT: Record<LevelVerdict, { text: string; className: string }> = {
  silent: { text: 'No signal — play or sing to test', className: 'text-ink-dim' },
  'too-quiet': { text: 'Too quiet — move closer or raise input gain', className: 'text-amber-400' },
  good: { text: 'Good level', className: 'text-accent' },
  hot: { text: 'Hot — back off a little', className: 'text-amber-400' },
  clipping: { text: 'Clipping — lower the input gain', className: 'text-red-400' },
};

export function InputPanel() {
  const micReady = useProjectStore((s) => s.micReady);
  const busy = useProjectStore((s) => s.busy);
  const constraints = useProjectStore((s) => s.micConstraints);
  const calibrated = useProjectStore((s) => s.calibrated);
  const latencyMs = useProjectStore((s) => s.inputLatencyOffsetMs);
  const state = useProjectStore((s) => s.state);

  const monitorRef = useRef(new InputMonitor());
  const rmsBarRef = useRef<HTMLDivElement>(null);
  const peakBarRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const [verdict, setVerdict] = useState<LevelVerdict>('silent');

  useEffect(() => {
    const monitor = monitorRef.current;
    monitor.attach(engine.recording.analyser);

    let frame = 0;
    let lastVerdict: LevelVerdict | null = null;

    const tick = () => {
      // Re-attach if the stream was re-acquired (a constraint change rebuilds
      // the whole graph, which replaces the analyser node).
      if (engine.recording.analyser && !monitor.isAttached) {
        monitor.attach(engine.recording.analyser);
      }

      const level = monitor.sample(performance.now());

      if (rmsBarRef.current) {
        rmsBarRef.current.style.width = `${dbToMeterPosition(level.rmsDb) * 100}%`;
      }
      if (peakBarRef.current) {
        peakBarRef.current.style.width = `${dbToMeterPosition(level.peakDb) * 100}%`;
      }
      if (holdRef.current) {
        holdRef.current.style.left = `${dbToMeterPosition(level.peakHoldDb) * 100}%`;
      }
      if (readoutRef.current) {
        readoutRef.current.textContent = `${fmt(level.peakDb)} peak · ${fmt(level.rmsDb)} RMS`;
      }

      const next = judgeLevel(level.peakHoldDb, level.clipped);
      if (next !== lastVerdict) {
        lastVerdict = next;
        setVerdict(next);
      }

      frame = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(frame);
  }, [micReady]);

  const resetMeter = () => {
    monitorRef.current.reset();
    setVerdict('silent');
  };

  if (!micReady) {
    return (
      <section className="flex flex-col gap-3 rounded-xl border border-edge bg-surface-raised p-4">
        <h2 className="text-sm font-medium">Input</h2>
        <p className="text-xs text-ink-dim">
          Enable the microphone to see live levels and check your settings before
          recording.
        </p>
        <button
          onClick={() => void projectActions.enableMic()}
          disabled={busy}
          className="h-11 rounded-lg border border-accent bg-accent/10 px-4 text-sm font-medium text-accent disabled:opacity-40"
        >
          {busy ? 'Requesting…' : 'Enable microphone'}
        </button>
        <Diagnostics />
      </section>
    );
  }

  const settings = engine.recording.getAppliedConstraints();

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2 rounded-xl border border-edge bg-surface-raised p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Input level</h2>
          <span ref={readoutRef} className="font-mono text-[11px] text-ink-dim">
            — peak · — RMS
          </span>
        </div>

        {/* Peak sits behind RMS: the darker bar shows transients, the bright
            one shows body. Together they read at a glance. */}
        <div className="relative h-6 overflow-hidden rounded-md bg-surface">
          <div ref={peakBarRef} className="absolute inset-y-0 left-0 bg-accent/30" style={{ width: '0%' }} />
          <div ref={rmsBarRef} className="absolute inset-y-0 left-0 bg-accent" style={{ width: '0%' }} />
          <div
            ref={holdRef}
            className="absolute inset-y-0 w-0.5 bg-ink"
            style={{ left: '0%' }}
          />
          {/* -12 dB target marker: aim for peaks around here. */}
          <div
            className="absolute inset-y-0 w-px bg-ink-dim/50"
            style={{ left: `${dbToMeterPosition(-12) * 100}%` }}
          />
        </div>

        <div className="flex justify-between font-mono text-[10px] text-ink-dim">
          <span>-60</span>
          <span>-30</span>
          <span>-12</span>
          <span>0 dB</span>
        </div>

        <p className={`text-xs font-medium ${VERDICT[verdict].className}`}>
          {VERDICT[verdict].text}
        </p>
        <p className="text-[11px] text-ink-dim">
          Aim for peaks near the -12 dB mark. The thin white line is a peak hold.
        </p>

        <div className="flex gap-2">
          <button
            onClick={resetMeter}
            className="h-9 rounded-lg border border-edge px-3 text-xs text-ink-dim"
          >
            Reset peak hold
          </button>
          {state === 'recording' && (
            <span className="self-center text-xs text-red-400">Recording</span>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-edge bg-surface-raised p-4">
        <h2 className="text-sm font-medium">Processing</h2>
        {(Object.keys(CONSTRAINT_COPY) as (keyof MicConstraints)[]).map((key) => (
          <label key={key} className="flex gap-2 text-xs">
            <input
              type="checkbox"
              checked={constraints[key]}
              disabled={busy}
              onChange={(e) => void projectActions.setConstraint(key, e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[oklch(0.82_0.15_175)]"
            />
            <span>
              <span className="font-medium">{CONSTRAINT_COPY[key].label}</span>
              <span className="block text-[11px] text-ink-dim">{CONSTRAINT_COPY[key].hint}</span>
            </span>
          </label>
        ))}
        <p className="text-[11px] text-ink-dim">
          Changing any of these re-acquires the microphone, since constraints
          apply when the stream is opened.
        </p>
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-edge bg-surface-raised p-4">
        <h2 className="text-sm font-medium">Latency</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void projectActions.calibrate()}
            disabled={busy || state === 'calibrating'}
            className={`h-9 rounded-lg border px-3 text-xs disabled:opacity-40 ${
              calibrated ? 'border-edge text-ink-dim' : 'border-accent text-accent'
            }`}
          >
            {state === 'calibrating' ? 'Listening…' : calibrated ? 'Re-calibrate' : 'Calibrate'}
          </button>
          <span className="font-mono text-xs text-ink-dim">
            {calibrated ? `${latencyMs.toFixed(1)} ms round trip` : 'not calibrated'}
          </span>
        </div>
        <p className="text-[11px] text-ink-dim">
          Play the click through speakers, not headphones — this measures how
          long sound takes to get out and back. Without it, overdubs land late
          by that amount.
        </p>
      </section>

      {settings && (
        <details className="rounded-xl border border-edge bg-surface-raised p-4">
          <summary className="cursor-pointer text-sm font-medium">
            What the browser actually granted
          </summary>
          <pre className="mt-2 overflow-x-auto font-mono text-[10px] text-ink-dim">
            {JSON.stringify(settings, null, 2)}
          </pre>
          <p className="mt-1 text-[11px] text-ink-dim">
            Browsers may ignore a requested constraint. This is what took effect.
          </p>
        </details>
      )}

      <Diagnostics />
    </div>
  );
}

function fmt(db: number): string {
  return Number.isFinite(db) ? `${db.toFixed(1)} dB` : '−∞';
}
