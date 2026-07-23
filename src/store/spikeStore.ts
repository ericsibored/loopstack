/**
 * Shared state for the Phase 0 harness.
 *
 * Zustand, decided per §10 — one store pattern, not mixed with Context. The
 * real `projectStore` lands in Phase 1; this holds only what the spikes need to
 * pass data between panels (a recording made in one panel, analysed in
 * another). Audio buffers live here as plain references, not React state
 * copies: the engine owns them, the store just points at them.
 */

import { create } from 'zustand';
import type { CaptureResult } from '../audio-engine/types';

export interface SpikeTrackInfo {
  id: string;
  label: string;
  samples: Float32Array;
  sampleRate: number;
  offsetMs: number;
  muted: boolean;
  soloed: boolean;
}

interface SpikeState {
  loopLengthSec: number;
  transportRunning: boolean;
  tracks: SpikeTrackInfo[];
  lastCapture: CaptureResult | null;
  inputLatencyOffsetMs: number;

  setLoopLength: (sec: number) => void;
  setTransportRunning: (running: boolean) => void;
  addTrack: (track: SpikeTrackInfo) => void;
  updateTrack: (id: string, patch: Partial<SpikeTrackInfo>) => void;
  removeTrack: (id: string) => void;
  setLastCapture: (capture: CaptureResult | null) => void;
  setInputLatency: (ms: number) => void;
}

export const useSpikeStore = create<SpikeState>((set) => ({
  loopLengthSec: 2,
  transportRunning: false,
  tracks: [],
  lastCapture: null,
  inputLatencyOffsetMs: 0,

  setLoopLength: (loopLengthSec) => set({ loopLengthSec }),
  setTransportRunning: (transportRunning) => set({ transportRunning }),
  addTrack: (track) => set((s) => ({ tracks: [...s.tracks, track] })),
  updateTrack: (id, patch) =>
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
  removeTrack: (id) => set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) })),
  setLastCapture: (lastCapture) => set({ lastCapture }),
  setInputLatency: (inputLatencyOffsetMs) => set({ inputLatencyOffsetMs }),
}));
