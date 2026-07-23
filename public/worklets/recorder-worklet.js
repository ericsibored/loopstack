/**
 * Capture worklet. Plain JS in /public so it can be handed straight to
 * `audioWorklet.addModule()` without a build step.
 *
 * It does no processing — it copies input blocks out to the main thread and,
 * critically, stamps the AudioWorkletGlobalScope `currentTime` of the first
 * captured block. That stamp is the anchor for every alignment calculation
 * downstream: it tells us exactly which AudioContext time `samples[0]`
 * corresponds to. Measuring capture start on the main thread instead would
 * inherit message-passing latency.
 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.announcedStart = false;
    this.port.onmessage = (event) => {
      const { type } = event.data;
      if (type === 'start') {
        this.recording = true;
        this.announcedStart = false;
      } else if (type === 'stop') {
        this.recording = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // No input connected yet (or a silent render quantum) — stay alive.
    if (!channel) return true;

    if (this.recording) {
      if (!this.announcedStart) {
        this.announcedStart = true;
        this.port.postMessage({
          type: 'started',
          startTime: currentTime,
          sampleRate: sampleRate,
        });
      }
      const copy = new Float32Array(channel.length);
      copy.set(channel);
      this.port.postMessage({ type: 'chunk', samples: copy }, [copy.buffer]);
    }

    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
