/**
 * Phase 0 spike harness (§8.1).
 *
 * Deliberately unstyled beyond legibility — this is a bench, not the product
 * UI. Its job is to make each of the four spikes runnable on a real phone
 * browser, since that is where the audio-timing answers actually live.
 */

import { AlignSpike } from './AlignSpike';
import { DenoiseSpike } from './DenoiseSpike';
import { LoopSpike } from './LoopSpike';
import { RecordSpike } from './RecordSpike';
import './spike.css';

export function SpikeHarness() {
  return (
    <main className="harness">
      <header>
        <h1>Loopstack — Phase 0 bench</h1>
        <p className="hint">
          Run this on a real iPhone and a mid-tier Android before building UI on
          top. Every panel needs a tap first: iOS Safari will not start an
          AudioContext otherwise.
        </p>
      </header>
      <LoopSpike />
      <RecordSpike />
      <DenoiseSpike />
      <AlignSpike />
    </main>
  );
}
