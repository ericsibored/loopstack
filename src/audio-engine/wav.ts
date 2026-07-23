/**
 * WAV encoding for export (§4.6).
 *
 * 16-bit PCM, written by hand. This is the whole reason MVP export needs no
 * dependency at all — FFmpeg WASM (~25 MB) stays deferred until someone
 * actually asks for MP3/AAC.
 */

const BITS_PER_SAMPLE = 16;
const PCM_FORMAT = 1;
const HEADER_BYTES = 44;

/** Encodes interleaved-by-channel Float32 data as a 16-bit PCM WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  if (channels.length === 0) throw new Error('encodeWav requires at least one channel');

  const channelCount = channels.length;
  const frameCount = channels[0].length;
  const bytesPerSample = BITS_PER_SAMPLE / 8;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = frameCount * blockAlign;

  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, PCM_FORMAT, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  // Interleave. Clamping before scaling matters: a mixdown that sums several
  // tracks can exceed ±1, and letting that wrap would turn a hot mix into
  // loud noise rather than mere clipping.
  let offset = HEADER_BYTES;
  for (let frame = 0; frame < frameCount; frame++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][frame]));
      view.setInt16(offset, Math.round(sample * 32767), true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** Convenience wrapper for a rendered AudioBuffer. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const channels: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }
  return encodeWav(channels, buffer.sampleRate);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
