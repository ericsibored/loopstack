import { describe, expect, it } from 'vitest';
import { encodeWav } from '../../src/audio-engine/wav';

async function parse(blob: Blob) {
  const view = new DataView(await blob.arrayBuffer());
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(
      ...Array.from({ length }, (_, i) => view.getUint8(offset + i)),
    );
  return {
    view,
    riff: ascii(0, 4),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    data: ascii(36, 4),
    riffSize: view.getUint32(4, true),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bitsPerSample: view.getUint16(34, true),
    dataSize: view.getUint32(40, true),
  };
}

describe('encodeWav', () => {
  it('writes a valid 16-bit PCM header', async () => {
    const samples = new Float32Array(100);
    const parsed = await parse(encodeWav([samples], 48000));

    expect(parsed.riff).toBe('RIFF');
    expect(parsed.wave).toBe('WAVE');
    expect(parsed.fmt).toBe('fmt ');
    expect(parsed.data).toBe('data');
    expect(parsed.format).toBe(1);
    expect(parsed.channels).toBe(1);
    expect(parsed.sampleRate).toBe(48000);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.blockAlign).toBe(2);
    expect(parsed.byteRate).toBe(96000);
    expect(parsed.dataSize).toBe(200);
    expect(parsed.riffSize).toBe(36 + 200);
  });

  it('sizes a stereo file correctly', async () => {
    const parsed = await parse(
      encodeWav([new Float32Array(50), new Float32Array(50)], 44100),
    );
    expect(parsed.channels).toBe(2);
    expect(parsed.blockAlign).toBe(4);
    expect(parsed.byteRate).toBe(44100 * 4);
    expect(parsed.dataSize).toBe(50 * 4);
  });

  it('interleaves channels frame by frame', async () => {
    const left = Float32Array.from([1, 1, 1]);
    const right = Float32Array.from([-1, -1, -1]);
    const { view } = await parse(encodeWav([left, right], 48000));

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
    expect(view.getInt16(48, true)).toBe(32767);
    expect(view.getInt16(50, true)).toBe(-32767);
  });

  it('clamps rather than wrapping when a mix exceeds full scale', async () => {
    // A four-layer mixdown can easily sum past ±1. Wrapping would turn a hot
    // mix into loud noise, which is far worse than clipping.
    const hot = Float32Array.from([2.5, -3.0]);
    const { view } = await parse(encodeWav([hot], 48000));

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
  });

  it('rejects an empty channel list', () => {
    expect(() => encodeWav([], 48000)).toThrow();
  });
});
