/**
 * Spike 3 — rnnoise WASM (§8.1, §6.4).
 *
 * The numbers that matter for the go/no-go call are the load time, the realtime
 * factor (process time ÷ audio duration — must be well under 1 on a mid-tier
 * Android), and whether A/B actually sounds better. Bundle cost is fixed and
 * printed below.
 */

import { useState } from 'react';
import { getEngine } from '../audio-engine/engine';
import { RnnoiseBackend, DenoisePreview } from '../audio-engine/denoiseProcessor';
import { toAudioBuffer } from '../audio-engine/recordingManager';
import { useSpikeStore } from '../store/spikeStore';
import { addNoise, makeRhythmLoop, rmsDb } from './testSignals';

export function DenoiseSpike() {
  const engine = getEngine();
  const { lastCapture, loopLengthSec } = useSpikeStore();

  const [status, setStatus] = useState('Not loaded.');
  const [preview, setPreview] = useState<DenoisePreview | null>(null);
  const [busy, setBusy] = useState(false);

  const backend = engine.denoise as RnnoiseBackend;

  const load = async () => {
    setBusy(true);
    try {
      const loadMs = await backend.init();
      setStatus(`Loaded ${backend.name} in ${loadMs.toFixed(0)}ms.`);
    } catch (error) {
      setStatus(`Load failed: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const run = async (source: 'synthetic' | 'capture') => {
    setBusy(true);
    try {
      const sampleRate =
        source === 'capture' && lastCapture ? lastCapture.sampleRate : engine.ctx.sampleRate;

      let raw: Float32Array;
      if (source === 'capture') {
        if (!lastCapture) {
          setStatus('No capture yet — record or calibrate in panel 2 first.');
          return;
        }
        raw = lastCapture.samples;
      } else {
        raw = addNoise(makeRhythmLoop(sampleRate, loopLengthSec, 330), 0.08);
      }

      const started = performance.now();
      const processed = await backend.process(raw, sampleRate);
      const wallMs = performance.now() - started;

      const stats = backend.getLastStats();
      const durationSec = raw.length / sampleRate;
      const realtimeFactor = (stats?.processMs ?? wallMs) / 1000 / durationSec;

      setPreview(new DenoisePreview(raw, processed, sampleRate, stats));
      setStatus(
        `${durationSec.toFixed(2)}s audio · model ${stats?.processMs.toFixed(0) ?? '?'}ms ` +
          `· wall ${wallMs.toFixed(0)}ms · realtime factor ${realtimeFactor.toFixed(3)} ` +
          `· resampled ${stats?.resampled ? 'yes' : 'no'} · meanVAD ${stats?.meanVad.toFixed(3) ?? '?'} ` +
          `· ${rmsDb(raw).toFixed(1)} → ${rmsDb(processed).toFixed(1)} dBFS`,
      );
    } catch (error) {
      setStatus(`Process failed: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const play = async (which: 'raw' | 'processed') => {
    if (!preview) return;
    await engine.unlock();
    const samples = which === 'raw' ? preview.raw : preview.processed;
    const source = engine.ctx.createBufferSource();
    source.buffer = toAudioBuffer(engine.ctx, samples, preview.sampleRate);
    source.connect(engine.ctx.destination);
    source.start();
  };

  return (
    <section className="panel">
      <h2>3 · De-noise (rnnoise WASM)</h2>
      <p className="hint">
        Bundle cost: 112&nbsp;KB wasm + 12&nbsp;KB glue, loaded in a worker and
        only on demand. rnnoise is speech-trained — expect it to be unkind to
        sustained instrument tone, which is the thing to judge in A/B.
      </p>

      <div className="row">
        <button onClick={load} disabled={busy}>
          Load model
        </button>
        <button onClick={() => run('synthetic')} disabled={busy}>
          Process synthetic
        </button>
        <button onClick={() => run('capture')} disabled={busy || !lastCapture}>
          Process last capture
        </button>
      </div>

      <div className="row">
        <button onClick={() => play('raw')} disabled={!preview}>
          ▶ Before
        </button>
        <button onClick={() => play('processed')} disabled={!preview}>
          ▶ After
        </button>
      </div>

      <p className="status">{status}</p>
    </section>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
