/**
 * Live engine health.
 *
 * This exists because "it stopped working after a few seconds" has several very
 * different causes that look identical from the outside: the AudioContext being
 * suspended by the browser, the scheduler stalling, or the mic stream ending.
 * Each shows up differently here, so a report can name the actual failure
 * instead of the symptom.
 *
 * Polled on a timer rather than rAF: it must keep updating in a backgrounded
 * tab, which is exactly when some of these failures happen.
 */

import { useEffect, useState } from 'react';
import { engine } from '../../store/projectStore';

interface Health {
  ctxState: string;
  ctxTime: number;
  sampleRate: number;
  transportRunning: boolean;
  boundariesEmitted: number;
  secondsUntilNextBoundary: number;
  workerTickerAlive: boolean | null;
  micLive: boolean;
  micTrackState: string;
}

export function Diagnostics() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const read = () => {
      const clockHealth = engine.clock.getHealth();
      const track = engine.recording.getAppliedConstraints();
      setHealth({
        ctxState: engine.ctx.state,
        ctxTime: engine.ctx.currentTime,
        sampleRate: engine.ctx.sampleRate,
        transportRunning: clockHealth.running,
        boundariesEmitted: clockHealth.boundariesEmitted,
        secondsUntilNextBoundary: clockHealth.secondsUntilNextBoundary,
        workerTickerAlive: clockHealth.workerTickerAlive,
        micLive: engine.recording.isInitialized,
        micTrackState: track ? 'live' : 'none',
      });
    };
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, []);

  if (!health) return null;

  // A transport that claims to be running but whose next boundary is well in
  // the past means the scheduler has stalled — the single most useful signal.
  const stalled = health.transportRunning && health.secondsUntilNextBoundary < -1;

  return (
    <details className="rounded-xl border border-edge bg-surface-raised p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Diagnostics
        {stalled && <span className="ml-2 text-xs text-red-400">scheduler stalled</span>}
        {engine.ctx.state !== 'running' && (
          <span className="ml-2 text-xs text-amber-400">audio {engine.ctx.state}</span>
        )}
      </summary>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
        <Row label="audio context" value={health.ctxState} warn={health.ctxState !== 'running'} />
        <Row label="context clock" value={`${health.ctxTime.toFixed(1)}s`} />
        <Row label="sample rate" value={`${health.sampleRate} Hz`} />
        <Row label="transport" value={health.transportRunning ? 'running' : 'stopped'} />
        <Row label="loops scheduled" value={String(health.boundariesEmitted)} />
        <Row
          label="next boundary"
          value={health.transportRunning ? `${health.secondsUntilNextBoundary.toFixed(2)}s` : '—'}
          warn={stalled}
        />
        {/* Only meaningful once the transport has actually asked for ticks —
            before that, "not ticking" is just "not started" and would read as
            a fault that isn't there. */}
        <Row
          label="worker timer"
          value={
            !health.transportRunning
              ? 'idle'
              : health.workerTickerAlive === null
                ? 'n/a'
                : health.workerTickerAlive
                  ? 'alive'
                  : 'not ticking (using fallback)'
          }
          warn={health.transportRunning && health.workerTickerAlive === false}
        />
        <Row label="microphone" value={health.micLive ? health.micTrackState : 'not enabled'} />
      </dl>

      <p className="mt-2 text-[11px] text-ink-dim">
        If playback stops, check whether <em>loops scheduled</em> is still
        climbing. If it is frozen while the transport says running, the
        scheduler stalled. If <em>audio context</em> is not running, the browser
        suspended it.
      </p>
    </details>
  );
}

function Row({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <>
      <dt className="text-ink-dim">{label}</dt>
      <dd className={warn ? 'text-amber-400' : 'text-ink'}>{value}</dd>
    </>
  );
}
