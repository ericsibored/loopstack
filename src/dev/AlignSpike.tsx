/**
 * Spike 4 — cross-correlation auto-align (§8.1, §6.3).
 *
 * The synthetic test is the meaningful one: it shifts a known signal by a known
 * amount, so the suggestion can be scored against ground truth rather than
 * judged by ear. Error should land within a sample or two.
 */

import { useState } from 'react';
import { DEFAULT_ALIGN_SEARCH_MS } from '../audio-engine/constants';
import { getEngine } from '../audio-engine/engine';
import { msToSamples } from '../audio-engine/crossCorrelation';
import { useSpikeStore } from '../store/spikeStore';
import { addNoise, makeRhythmLoop, shiftSignal } from './testSignals';

interface Outcome {
  label: string;
  suggestedOffsetMs: number;
  confidence: number;
  elapsedMs: number;
  expectedOffsetMs: number | null;
}

export function AlignSpike() {
  const engine = getEngine();
  const { tracks, loopLengthSec } = useSpikeStore();

  const [trueShiftMs, setTrueShiftMs] = useState(37);
  const [noise, setNoise] = useState(0.05);
  const [searchMs, setSearchMs] = useState(DEFAULT_ALIGN_SEARCH_MS);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSynthetic = async () => {
    setBusy(true);
    setError(null);
    try {
      const sampleRate = engine.ctx.sampleRate;
      const reference = makeRhythmLoop(sampleRate, loopLengthSec, 330);
      const shifted = shiftSignal(reference, msToSamples(trueShiftMs, sampleRate));
      const candidate = noise > 0 ? addNoise(shifted, noise) : shifted;

      const suggestion = await engine.alignment.suggestAlignment(
        reference,
        candidate,
        sampleRate,
        searchMs,
      );

      setOutcomes((prev) => [
        {
          label: `synthetic +${trueShiftMs}ms, noise ${noise}`,
          suggestedOffsetMs: suggestion.suggestedOffsetMs,
          confidence: suggestion.confidence,
          elapsedMs: suggestion.elapsedMs,
          expectedOffsetMs: -trueShiftMs,
        },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runOnTracks = async () => {
    if (tracks.length < 2) {
      setError('Need at least two layers — record or add one in the panels above.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [reference, candidate] = tracks;
      const suggestion = await engine.alignment.suggestAlignment(
        reference.samples,
        candidate.samples,
        reference.sampleRate,
        searchMs,
      );
      setOutcomes((prev) => [
        {
          label: `${candidate.label} vs ${reference.label}`,
          suggestedOffsetMs: suggestion.suggestedOffsetMs,
          confidence: suggestion.confidence,
          elapsedMs: suggestion.elapsedMs,
          expectedOffsetMs: null,
        },
        ...prev,
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>4 · Auto-align (cross-correlation)</h2>
      <p className="hint">
        Suggestions only — nothing is applied to a track. Error is the gap
        between the suggested offset and the shift actually introduced.
      </p>

      <div className="row">
        <label>
          True shift (ms)
          <input
            type="number"
            value={trueShiftMs}
            step={1}
            onChange={(e) => setTrueShiftMs(Number(e.target.value))}
          />
        </label>
        <label>
          Noise
          <input
            type="number"
            value={noise}
            step={0.01}
            min={0}
            max={1}
            onChange={(e) => setNoise(Number(e.target.value))}
          />
        </label>
        <label>
          Search ±(ms)
          <input
            type="number"
            value={searchMs}
            step={10}
            min={10}
            onChange={(e) => setSearchMs(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="row">
        <button onClick={runSynthetic} disabled={busy}>
          Run synthetic test
        </button>
        <button onClick={runOnTracks} disabled={busy}>
          Align layer 2 → layer 1
        </button>
        <button onClick={() => setOutcomes([])} disabled={busy}>
          Clear
        </button>
      </div>

      {error && <p className="status error">{error}</p>}

      <table className="results">
        <thead>
          <tr>
            <th>case</th>
            <th>suggested</th>
            <th>error</th>
            <th>confidence</th>
            <th>time</th>
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o, i) => (
            <tr key={i}>
              <td>{o.label}</td>
              <td className="mono">{o.suggestedOffsetMs.toFixed(2)}ms</td>
              <td className="mono">
                {o.expectedOffsetMs === null
                  ? '—'
                  : `${(o.suggestedOffsetMs - o.expectedOffsetMs).toFixed(2)}ms`}
              </td>
              <td className="mono">{o.confidence.toFixed(3)}</td>
              <td className="mono">{o.elapsedMs.toFixed(1)}ms</td>
            </tr>
          ))}
          {outcomes.length === 0 && (
            <tr>
              <td colSpan={5} className="hint">
                No runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
