# Loopstack — Phases 0–2

Web looper built to the technical architecture doc. Phase 0 (§8.1) engine
spikes, Phase 1 (§8.2) MVP and Phase 2 (§8.3) mixing/alignment are done.
Phase 3 (sharing, PWA, persistence) has not been started.

```bash
npm run dev        # app at http://localhost:5173 (also served on the LAN)
                   # Phase 0 bench at /?bench
npm test           # unit tests (Vitest)
npm run typecheck  # tsc
npm run build
```

## What exists

| Module | File | State |
|---|---|---|
| TransportClock | `src/audio-engine/transportClock.ts` | Working, unit-tested |
| PlaybackManager | `src/audio-engine/playbackManager.ts` | Working |
| RecordingManager | `src/audio-engine/recordingManager.ts` + `public/worklets/recorder-worklet.js` | Working, loop-slicing unit-tested |
| LoopController | `src/audio-engine/loopController.ts` | Working — the looper state machine |
| AlignmentEngine | `src/audio-engine/alignmentEngine.ts` | Working, surfaced in the UI (calibration + auto-align + snap) |
| DenoiseProcessor | `src/audio-engine/denoiseProcessor.ts` | Working (rnnoise), with in-context A/B preview |
| Metronome | `src/audio-engine/metronome.ts` | Working (beat grid + count-in) |
| MixdownRenderer | `src/audio-engine/mixdownRenderer.ts` + `wav.ts` | Working, WAV export verified |
| Persistence | — | Not started (Phase 3) |

The engine imports no React. `src/store/projectStore.ts` is a *mirror* of
LoopController's published snapshots — the controller owns the state machine and
the audio graph, so no re-render can disturb timing. Commands go the other way,
straight to the controller.

## Phase 1 UI

- **Record button** whose label is the status display — first take sets the loop
  length, later takes arm and auto-stop after exactly one lap.
- **Up to 4 layers** (`MAX_LAYERS`), enforced in the engine and the UI.
- **Mute / solo / delete** per layer. Mute beats solo on the same track.
- **Manual nudge** at ±5 ms, non-destructive; tap the readout to reset.
- **Peak waveform** per layer on canvas, with a live playhead, drawn off React's
  render path.
- **Native `noiseSuppression` toggle** (re-acquires the mic, since constraints
  apply at `getUserMedia` time).
- **WAV export** at ×1/×2/×4/×8 loop repeats.

## Phase 2 UI

- **Latency calibration** in the transport bar, not buried in settings — it is
  the difference between overdubs that line up on their own and overdubs the
  user nudges by hand every time. Implausible measurements (negative, or over
  500 ms) are rejected rather than applied.
- **Gain, pan and reorder** per layer, behind a per-track disclosure so the
  controls you need mid-performance aren't competing with the ones you use
  sitting still.
- **Auto-align assist** — cross-correlates against the layer above and offers
  the result with a confidence figure. Never applied automatically; below 0.4
  confidence the UI says to check by ear.
- **Post-capture de-noise with in-context A/B.** The processed audio is swapped
  in *while the loop keeps playing*, so artefacts are judged against the other
  layers rather than in isolation. Keep or discard; the original is retained
  until you commit.
- **Metronome, count-in and BPM grid.** BPM is optional — free-length is the
  default, since forcing a tempo decision before the first take is exactly the
  friction a looper avoids. Setting it unlocks the metronome, count-in,
  snap-to-beat, and rounding the first take to whole beats.

Deliberately *not* built yet: persistence, PWA, Web Share, MP3/AAC export
(all Phase 3, §8.4).

## Spike results (desktop Chrome, 48 kHz)

Three of the four exit criteria are met on desktop. The fourth — seamless
looping by ear — cannot be judged headlessly and is a real-device task.

**Loop scheduling.** Boundaries fire exactly `loopLength` apart; position and
iteration track `AudioContext.currentTime`. Verified over multiple iterations
with a Worker-driven lookahead. *Not yet verified: audible seamlessness on iOS
Safari / Android Chrome.*

**Cross-correlation auto-align.** A 37 ms shift with noise at 0.05 amplitude was
recovered with **0.00 ms error at 0.959 confidence in 33 ms** for a 2 s loop.
Unit tests cover positive/negative shifts, noise, and agreement between the
coarse-to-fine path and a full-rate exhaustive scan.

**rnnoise (WASM).** Loads in ~5 ms warm; processes 2 s of audio in **31 ms —
realtime factor 0.015**. Bundle cost is **112 KB wasm + 12 KB glue**, in a
separate worker chunk, fetched only when de-noise is first used. *Not yet
verified: mid-tier Android timing, which is the number that actually decides
whether the real-time path is viable.*

**Capture.** Implemented and typechecked; requires a mic and a real device to
exercise. Run panels 2 and 3 of the bench on a phone.

**Auto-align in the app.** A layer shifted 40 ms late (with noise) drew a
suggestion of **−40.0 ms at 0.99 confidence**; applying it set the offset and
cleared the suggestion. Snap-to-beat then rounded −40 ms to 0 on a 120 BPM grid.

**De-noise A/B.** Real rnnoise in the browser: peak 0.5071 → 0.4961, toggling
preview flipped the waveform and the audio back and forth, and committing kept
the processed version. A second pass runs on the committed audio, not the
original.

**Metronome.** 8 clicks over 2 loops at 120 BPM, every gap exactly 0.500 s, one
accented downbeat per loop — the grid stays anchored to loop boundaries.

**Full capture path, via a synthetic mic.** `createMediaStreamDestination()`
yields a genuine MediaStream, so `src/dev/virtualMic.ts` drives the real capture
pipeline with hits at times we know exactly — making accuracy measurable rather
than a matter of listening. Results at 48 kHz on a 2 s loop:

| Take | Click onsets (expected 0.25 / 0.75 / 1.25 / 1.75 s) | Error |
|---|---|---|
| Overdub, uncalibrated | 0.267, 0.767, 1.267, 1.767 | **+17 ms on every hit** |
| Overdub, `inputLatencyOffsetMs = 17` | 0.246, 0.746, 1.246, 1.746 | **−4 ms** (one waveform bucket) |

The +17 ms is the MediaStream input path latency, and it is a *constant bias,
not jitter* — which is the case latency compensation is built for. Applying the
measured offset cancels it. This is the clearest evidence available that
calibration does what it claims; on real hardware the number will be larger
(acoustic travel plus driver buffering) but should behave the same way.

**Export.** Verified end to end against a real `OfflineAudioContext`: a 2-layer,
2 s loop at ×2 rendered 4.50 s of stereo (2×2 s plus the 0.5 s tail), byte count
matching `44 + frames×4` exactly, valid RIFF/WAVE 16-bit header. Muting a layer
measurably changed the mix (RMS 0.0949 → 0.0671), so mute/solo genuinely reach
the render rather than only the UI.

## Decisions made

- **Zustand**, not Context — §10 asked for one to be picked early.
- **Separate `align.worker` and `denoise.worker`.** They have very different
  lifetimes: align is a short burst, de-noise holds a WASM instance. Merging
  them would mean loading the rnnoise binary to run a correlation.
- **rnnoise via `@jitsi/rnnoise-wasm`**, behind the `DenoiseBackend` interface
  in `types.ts`. Nothing outside `denoiseProcessor.ts` knows the model exists.
- **Capture is continuous, trimmed afterwards.** A worklet cannot be
  sample-scheduled, so rather than starting capture *on* a boundary, we start
  early, record the worklet's own capture-start timestamp, and cut the loop out
  of the middle. The cut is sample-accurate; a scheduled start would not be.
- **Milliseconds vs seconds are encoded in every field name** (`offsetMs`,
  `loopLengthSec`). Unit confusion is the most likely source of timing bugs here.
- **Loop length comes from the gap between the two button presses**, not from
  how much audio arrived — capture starts a render quantum early and the mic
  keeps running past the stop.
- **Mixdown mirrors PlaybackManager's scheduling** rather than concatenating
  buffers. If the two diverge, the exported file stops matching what the user
  heard, which is the worst export bug available.
- **WAV export clamps at full scale.** Four summed layers can exceed ±1;
  wrapping would turn a hot mix into loud noise rather than mere clipping.

## Open decisions

- **rnnoise is speech-trained.** On the synthetic tonal test it removed ~1.2 dB
  and reported a low voice-activity score. It will likely be unkind to sustained
  instrument tone, which is core material for a looper. Judge this by ear in the
  bench's A/B before committing to it beyond the spike — the interface is built
  to be swapped.
- **Real-time vs post-capture de-noise.** Only the post-capture path is built.
  §6.4 also wants a live filter; whether rnnoise in an AudioWorklet is worth the
  complexity over the browser-native `noiseSuppression` constraint is untested.
- **MediaRecorder codec support** (§10) is still unverified against current
  Safari. Not blocking: nothing captures via MediaRecorder — the worklet path
  produces raw PCM directly.
- **No real microphone or real room has been in the loop yet.** The full record
  → overdub → export path now runs end to end against a synthetic MediaStream
  (see below), which covers the worklet, timestamping, slicing and overdub
  arming. What it cannot cover is acoustic round trip, driver latency and room
  noise — exactly what calibration exists to measure. A device pass is still
  required before release.

## Use headphones

Loops played through a speaker get re-recorded by every subsequent overdub, so
by the fourth layer the first take has been through the mic three times, each
pass adding room and noise. Echo cancellation reduces that bleed; it does not
remove it. The one exception is *Calibrate latency*, which measures the
speaker→mic round trip and therefore needs the sound to physically travel.

## Testing on a phone

`getUserMedia` needs a secure context, so a bare `http://<lan-ip>:5173` will not
get mic permission on iOS. Put an HTTPS tunnel in front of the dev server. In
the console, `window.__loopEngine` exposes the engine in dev builds — the
on-screen playhead is rAF-driven and freezes in a backgrounded tab, so it is the
one readout not to trust when debugging remotely.

`window.__virtualMic.enable()` (dev only) swaps the mic for the synthetic
stream, which is how the capture path is exercised on a machine without one.
Both handles are code-split out of production builds.
