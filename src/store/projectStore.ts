/**
 * The app's Zustand store.
 *
 * It is a *mirror*, not a source of truth. The LoopController owns the state
 * machine and the audio graph; this store holds the last snapshot it published
 * so React can render it. Commands go the other way, straight to the
 * controller. Keeping the audio state out of React is what stops a re-render
 * from ever being able to disturb timing.
 */

import { create } from 'zustand';
import { getEngine } from '../audio-engine/engine';
import type { ControllerSnapshot } from '../audio-engine/loopController';
import { DEFAULT_MIC_CONSTRAINTS } from '../audio-engine/recordingManager';
import type { MicConstraints } from '../audio-engine/recordingManager';

interface ProjectStoreState extends ControllerSnapshot {
  micReady: boolean;
  micConstraints: MicConstraints;
  busy: boolean;
}

const engine = getEngine();

export const useProjectStore = create<ProjectStoreState>(() => ({
  ...engine.controller.snapshot(),
  micReady: false,
  micConstraints: DEFAULT_MIC_CONSTRAINTS,
  busy: false,
}));

engine.controller.subscribe((snapshot) => {
  useProjectStore.setState({ ...snapshot, micReady: engine.controller.micReady });
});

/** Commands. Components call these; they never write engine state directly. */
export const projectActions = {
  async enableMic(): Promise<void> {
    const { micConstraints } = useProjectStore.getState();
    useProjectStore.setState({ busy: true });
    try {
      await engine.unlock();
      await engine.controller.initMic(micConstraints);
      useProjectStore.setState({ micReady: true });
    } catch (e) {
      useProjectStore.setState({ error: describe(e) });
    } finally {
      useProjectStore.setState({ busy: false });
    }
  },

  /**
   * Constraints are applied at getUserMedia time, so changing one has to
   * re-acquire the stream rather than just setting a flag.
   */
  async setConstraint(key: keyof MicConstraints, value: boolean): Promise<void> {
    const next = { ...useProjectStore.getState().micConstraints, [key]: value };
    useProjectStore.setState({ micConstraints: next });
    if (useProjectStore.getState().micReady) {
      useProjectStore.setState({ busy: true });
      try {
        await engine.controller.initMic(next);
      } catch (e) {
        useProjectStore.setState({ error: describe(e) });
      } finally {
        useProjectStore.setState({ busy: false });
      }
    }
  },

  async toggleRecord(): Promise<void> {
    await engine.unlock();
    await engine.controller.toggleRecord();
  },

  play(): void {
    void engine.unlock().then(() => engine.controller.play());
  },

  pause(): void {
    engine.controller.pause();
  },

  stop(): void {
    engine.controller.stop();
  },

  clearAll(): void {
    engine.controller.clearAllTracks();
  },

  setMuted(id: string, muted: boolean): void {
    engine.controller.updateTrack(id, { muted });
  },

  setSoloed(id: string, soloed: boolean): void {
    engine.controller.updateTrack(id, { soloed });
  },

  nudge(id: string, deltaMs: number): void {
    const track = useProjectStore.getState().tracks.find((t) => t.id === id);
    if (!track) return;
    engine.controller.updateTrack(id, { offsetMs: track.offsetMs + deltaMs });
  },

  resetNudge(id: string): void {
    engine.controller.updateTrack(id, { offsetMs: 0 });
  },

  auditionTrack(id: string, loop = false): void {
    void engine.unlock().then(() => engine.controller.auditionTrack(id, loop));
  },

  stopAudition(): void {
    engine.controller.stopAudition();
  },

  setGain(id: string, gain: number): void {
    engine.controller.updateTrack(id, { gain });
  },

  setPan(id: string, pan: number): void {
    engine.controller.updateTrack(id, { pan });
  },

  moveTrack(id: string, delta: number): void {
    engine.controller.moveTrack(id, delta);
  },

  removeTrack(id: string): void {
    engine.controller.removeTrack(id);
  },

  setBpm(bpm: number | null): void {
    engine.controller.setBpm(bpm);
  },

  setMetronome(enabled: boolean): void {
    void engine.unlock().then(() => engine.controller.setMetronome(enabled));
  },

  setCountInBeats(beats: number): void {
    engine.controller.setCountInBeats(beats);
  },

  async calibrate(): Promise<void> {
    useProjectStore.setState({ busy: true });
    try {
      await engine.unlock();
      await engine.controller.calibrate();
    } finally {
      useProjectStore.setState({ busy: false });
    }
  },

  async requestAlignment(id: string): Promise<void> {
    await engine.controller.requestAlignment(id);
  },

  acceptAlignment(id: string): void {
    engine.controller.acceptAlignment(id);
  },

  rejectAlignment(id: string): void {
    engine.controller.rejectAlignment(id);
  },

  snapToGrid(id: string): void {
    engine.controller.snapTrackToGrid(id);
  },

  async runDenoise(id: string): Promise<void> {
    await engine.controller.runDenoise(id);
  },

  toggleDenoisePreview(id: string): void {
    engine.controller.toggleDenoisePreview(id);
  },

  commitDenoise(id: string, accept: boolean): void {
    engine.controller.commitDenoise(id, accept);
  },

  clearError(): void {
    engine.controller.clearStatus();
  },
};

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export { engine };
