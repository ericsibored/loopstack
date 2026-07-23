/**
 * Spike 2 — capture + latency calibration (§8.1, §6.2).
 *
 * Capture runs free and the loop is cut out afterwards, so the `setTimeout`
 * calls below only decide *when to stop recording*. They have no bearing on
 * where the loop is cut — that comes from the worklet's capture-start stamp.
 */

import { useState } from 'react';
import { AlignmentEngine } from '../audio-engine/alignmentEngine';
import { getReportedLatency } from '../audio-engine/audioContext';
import { MAX_LAYERS } from '../audio-engine/constants';
import { getEngine } from '../audio-engine/engine';
import { generateClick } from '../audio-engine/onsetDetection';
import { sliceLoop, toAudioBuffer, DEFAULT_MIC_CONSTRAINTS } from '../audio-engine/recordingManager';
import type { MicConstraints } from '../audio-engine/recordingManager';
import { useSpikeStore } from '../store/spikeStore';
import { rmsDb } from './testSignals';

const CALIBRATION_CLICK_DELAY_SEC = 0.3;
const CALIBRATION_CAPTURE_MS = 1200;

export function RecordSpike() {
  const engine = getEngine();
  const {
    loopLengthSec,
    transportRunning,
    tracks,
    inputLatencyOffsetMs,
    addTrack,
    setLastCapture,
    setInputLatency,
  } = useSpikeStore();

  const [constraints, setConstraints] = useState<MicConstraints>(DEFAULT_MIC_CONSTRAINTS);
  const [status, setStatus] = useState('Mic not initialised.');
  const [applied, setApplied] = useState<MediaTrackSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const initMic = async () => {
    setBusy(true);
    try {
      await engine.unlock();
      await engine.recording.init(constraints);
      setApplied(engine.recording.getAppliedConstraints());
      const reported = getReportedLatency(engine.ctx);
      setStatus(
        `Mic ready. Reported base latency ${(reported.baseLatencySec * 1000).toFixed(1)}ms, ` +
          `output latency ${(reported.outputLatencySec * 1000).toFixed(1)}ms.`,
      );
    } catch (error) {
      setStatus(`Mic init failed: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const calibrate = async () => {
    if (!engine.recording.isInitialized) {
      setStatus('Initialise the mic first.');
      return;
    }
    setBusy(true);
    setStatus('Calibrating — keep the room quiet and the speaker audible.');
    try {
      engine.recording.start();

      const sampleRate = engine.ctx.sampleRate;
      const click = generateClick(sampleRate);
      const buffer = toAudioBuffer(engine.ctx, click, sampleRate);
      const source = engine.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(engine.ctx.destination);
      const clickTime = engine.ctx.currentTime + CALIBRATION_CLICK_DELAY_SEC;
      source.start(clickTime);

      await delay(CALIBRATION_CAPTURE_MS);
      const capture = await engine.recording.stop();
      setLastCapture(capture);

      const result = AlignmentEngine.computeCalibration(
        capture.samples,
        capture.sampleRate,
        capture.startTime,
        clickTime,
      );

      if (!result.detected) {
        setStatus(
          `No click detected (captured ${capture.samples.length} samples at ` +
            `${rmsDb(capture.samples).toFixed(1)} dBFS). Raise the volume and retry.`,
        );
      } else {
        setInputLatency(result.inputLatencyOffsetMs);
        setStatus(`Round-trip latency ${result.inputLatencyOffsetMs.toFixed(1)}ms.`);
      }
    } catch (error) {
      setStatus(`Calibration failed: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const recordLoop = async () => {
    if (!engine.recording.isInitialized) {
      setStatus('Initialise the mic first.');
      return;
    }
    if (!transportRunning) {
      setStatus('Start the transport in panel 1 first.');
      return;
    }
    if (tracks.length >= MAX_LAYERS) {
      setStatus(`At the ${MAX_LAYERS}-layer cap.`);
      return;
    }

    setBusy(true);
    try {
      engine.recording.start();
      const boundary = engine.clock.getNextBoundaryAfter(engine.ctx.currentTime + 0.2);
      setStatus(`Armed — recording starts at the next loop boundary.`);

      // Wait past the end of the target loop, plus margin for the latency
      // offset pushing the slice window later into the capture.
      const waitMs =
        (boundary - engine.ctx.currentTime + loopLengthSec) * 1000 +
        Math.abs(inputLatencyOffsetMs) +
        300;
      await delay(waitMs);

      const capture = await engine.recording.stop();
      setLastCapture(capture);

      const samples = sliceLoop(capture, boundary, loopLengthSec, inputLatencyOffsetMs);
      const id = `rec-${Date.now()}`;
      engine.playback.addTrack({
        id,
        buffer: toAudioBuffer(engine.ctx, samples, capture.sampleRate),
        offsetMs: 0,
        gain: 0.9,
        pan: 0,
        muted: false,
        soloed: false,
      });
      addTrack({
        id,
        label: 'recorded',
        samples,
        sampleRate: capture.sampleRate,
        offsetMs: 0,
        muted: false,
        soloed: false,
      });
      setStatus(
        `Captured ${(capture.samples.length / capture.sampleRate).toFixed(2)}s, ` +
          `sliced ${loopLengthSec}s at ${rmsDb(samples).toFixed(1)} dBFS.`,
      );
    } catch (error) {
      setStatus(`Recording failed: ${describe(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleConstraint = (key: keyof MicConstraints) => {
    setConstraints((c) => ({ ...c, [key]: !c[key] }));
  };

  return (
    <section className="panel">
      <h2>2 · Capture &amp; latency calibration</h2>
      <p className="hint">
        Calibration needs speakers, not headphones — it measures the speaker→mic
        round trip. Re-run it after changing constraints or output device.
      </p>

      <div className="row">
        {(Object.keys(constraints) as (keyof MicConstraints)[]).map((key) => (
          <label key={key} className="check">
            <input
              type="checkbox"
              checked={constraints[key]}
              onChange={() => toggleConstraint(key)}
            />
            {key}
          </label>
        ))}
      </div>

      <div className="row">
        <button onClick={initMic} disabled={busy}>
          Initialise mic
        </button>
        <button onClick={calibrate} disabled={busy}>
          Calibrate latency
        </button>
        <button onClick={recordLoop} disabled={busy}>
          Record one loop
        </button>
      </div>

      <p className="mono">
        inputLatencyOffsetMs {inputLatencyOffsetMs.toFixed(1)}
      </p>
      <p className="status">{status}</p>

      {applied && (
        <pre className="mono small">{JSON.stringify(applied, null, 2)}</pre>
      )}
    </section>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
