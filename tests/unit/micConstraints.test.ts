import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIC_CONSTRAINTS,
  INSTRUMENT_MIC_CONSTRAINTS,
  VOICE_MIC_CONSTRAINTS,
} from '../../src/audio-engine/recordingManager';

/**
 * These defaults are load-bearing, not cosmetic. With the browser's speech
 * chain on, an instrument played through a speaker can be suppressed almost
 * entirely while voice still passes — which reads as "the mic is broken"
 * rather than "a setting is wrong". Pinning them here so the default cannot
 * drift back without a deliberate change.
 */
describe('mic constraint presets', () => {
  it('defaults to instrument mode with all processing off', () => {
    expect(DEFAULT_MIC_CONSTRAINTS).toEqual(INSTRUMENT_MIC_CONSTRAINTS);
    expect(INSTRUMENT_MIC_CONSTRAINTS).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    });
  });

  it('keeps the speech chain available for voice looping', () => {
    expect(VOICE_MIC_CONSTRAINTS.echoCancellation).toBe(true);
    expect(VOICE_MIC_CONSTRAINTS.noiseSuppression).toBe(true);
  });

  it('never enables auto gain in either preset', () => {
    // AGC changes level mid-take, so layers recorded seconds apart end up at
    // different volumes — bad in both modes.
    expect(INSTRUMENT_MIC_CONSTRAINTS.autoGainControl).toBe(false);
    expect(VOICE_MIC_CONSTRAINTS.autoGainControl).toBe(false);
  });

  it('has presets that actually differ', () => {
    expect(INSTRUMENT_MIC_CONSTRAINTS).not.toEqual(VOICE_MIC_CONSTRAINTS);
  });
});
