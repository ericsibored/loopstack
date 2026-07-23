/**
 * Spike 1 — seamless looping (§8.1).
 *
 * What to listen for: a sustained tone loop should have no click at the loop
 * boundary. If you hear one, the scheduler is late or the buffer length and
 * loop length disagree. The playhead readout is rAF-driven and for the eye
 * only; nothing here schedules from it.
 */

import { useEffect, useRef, useState } from 'react';
import { MAX_LAYERS } from '../audio-engine/constants';
import { getEngine } from '../audio-engine/engine';
import { toAudioBuffer } from '../audio-engine/recordingManager';
import { useSpikeStore } from '../store/spikeStore';
import { makeRhythmLoop, makeToneLoop } from './testSignals';

export function LoopSpike() {
  const engine = getEngine();
  const {
    loopLengthSec,
    transportRunning,
    tracks,
    setLoopLength,
    setTransportRunning,
    addTrack,
    updateTrack,
    removeTrack,
  } = useSpikeStore();

  const [position, setPosition] = useState(0);
  const [iteration, setIteration] = useState(-1);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const frame = () => {
      setPosition(engine.clock.getCurrentLoopPosition());
      setIteration(engine.clock.getCurrentIteration());
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [engine]);

  const start = async () => {
    await engine.unlock();
    engine.clock.start(loopLengthSec);
    setTransportRunning(true);
  };

  const stop = () => {
    engine.stopTransport();
    setTransportRunning(false);
  };

  const addSynthetic = async (kind: 'tone' | 'rhythm') => {
    await engine.unlock();
    if (tracks.length >= MAX_LAYERS) return;

    const sampleRate = engine.ctx.sampleRate;
    const samples =
      kind === 'tone'
        ? makeToneLoop(sampleRate, loopLengthSec, 220)
        : makeRhythmLoop(sampleRate, loopLengthSec, 330);

    const id = `${kind}-${Date.now()}`;
    engine.playback.addTrack({
      id,
      buffer: toAudioBuffer(engine.ctx, samples, sampleRate),
      offsetMs: 0,
      gain: 0.8,
      pan: 0,
      muted: false,
      soloed: false,
    });
    addTrack({ id, label: kind, samples, sampleRate, offsetMs: 0, muted: false, soloed: false });
  };

  const nudge = (id: string, deltaMs: number) => {
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    const offsetMs = track.offsetMs + deltaMs;
    engine.playback.updateTrack(id, { offsetMs });
    updateTrack(id, { offsetMs });
  };

  const toggle = (id: string, key: 'muted' | 'soloed') => {
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    const next = !track[key];
    engine.playback.updateTrack(id, { [key]: next });
    updateTrack(id, { [key]: next });
  };

  const drop = (id: string) => {
    engine.playback.removeTrack(id);
    removeTrack(id);
  };

  const progress = loopLengthSec > 0 ? (position / loopLengthSec) * 100 : 0;

  return (
    <section className="panel">
      <h2>1 · Loop scheduling</h2>
      <p className="hint">
        Add the tone layer and listen at the loop boundary. Any click means the
        scheduler is late — not a signal problem, the tone is cycle-aligned.
      </p>

      <div className="row">
        <label>
          Loop length (s)
          <input
            type="number"
            min={0.25}
            max={30}
            step={0.25}
            value={loopLengthSec}
            disabled={transportRunning}
            onChange={(e) => setLoopLength(Number(e.target.value))}
          />
        </label>
        {transportRunning ? (
          <button onClick={stop}>Stop transport</button>
        ) : (
          <button onClick={start}>Start transport</button>
        )}
        <button onClick={() => addSynthetic('tone')} disabled={tracks.length >= MAX_LAYERS}>
          + Tone layer
        </button>
        <button onClick={() => addSynthetic('rhythm')} disabled={tracks.length >= MAX_LAYERS}>
          + Rhythm layer
        </button>
      </div>

      <div className="playhead">
        <div className="playhead-fill" style={{ width: `${progress}%` }} />
      </div>
      <p className="mono">
        position {position.toFixed(3)}s · iteration {iteration} · sampleRate{' '}
        {engine.ctx.sampleRate} Hz · layers {tracks.length}/{MAX_LAYERS}
      </p>

      <ul className="tracks">
        {tracks.map((t) => (
          <li key={t.id}>
            <span className="track-name">{t.label}</span>
            <button className={t.muted ? 'on' : ''} onClick={() => toggle(t.id, 'muted')}>
              M
            </button>
            <button className={t.soloed ? 'on' : ''} onClick={() => toggle(t.id, 'soloed')}>
              S
            </button>
            <button onClick={() => nudge(t.id, -10)}>−10ms</button>
            <span className="mono offset">{t.offsetMs.toFixed(1)}ms</span>
            <button onClick={() => nudge(t.id, 10)}>+10ms</button>
            <button onClick={() => drop(t.id)}>✕</button>
          </li>
        ))}
        {tracks.length === 0 && <li className="hint">No layers yet.</li>}
      </ul>
    </section>
  );
}
