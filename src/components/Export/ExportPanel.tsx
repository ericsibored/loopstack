/**
 * WAV export (§8.2). MP3/AAC stays out of the MVP: it means FFmpeg WASM at
 * ~25 MB, which is not worth carrying before anyone has asked for it.
 */

import { useState } from 'react';
import { downloadBlob, renderMixdownToWav } from '../../audio-engine/mixdownRenderer';
import { engine, useProjectStore } from '../../store/projectStore';

const REPEAT_OPTIONS = [1, 2, 4, 8];

export function ExportPanel() {
  const tracks = useProjectStore((s) => s.tracks);
  const loopLengthSec = useProjectStore((s) => s.loopLengthSec);

  const [repeats, setRepeats] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportWav = async () => {
    if (!loopLengthSec) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await renderMixdownToWav({
        tracks: engine.controller.getPlayableTracks(),
        loopLengthSec,
        repeats,
        sampleRate: engine.ctx.sampleRate,
      });
      downloadBlob(blob, `loopstack-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.wav`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (tracks.length === 0 || !loopLengthSec) return null;

  const durationSec = loopLengthSec * repeats;

  return (
    <section className="rounded-xl border border-edge bg-surface-raised p-3">
      <h2 className="mb-2 text-sm font-medium text-ink-dim">Export</h2>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Loop repeats">
          {REPEAT_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setRepeats(n)}
              aria-pressed={repeats === n}
              className={`h-10 min-w-10 rounded-lg border px-2 text-sm ${
                repeats === n ? 'border-accent bg-accent text-surface' : 'border-edge text-ink-dim'
              }`}
            >
              ×{n}
            </button>
          ))}
        </div>
        <button
          onClick={() => void exportWav()}
          disabled={busy}
          className="h-10 flex-1 rounded-lg border border-edge bg-surface px-4 text-sm font-medium disabled:opacity-40"
        >
          {busy ? 'Rendering…' : 'Download WAV'}
        </button>
      </div>
      <p className="mt-2 font-mono text-xs text-ink-dim">
        {durationSec.toFixed(1)}s · {engine.ctx.sampleRate} Hz · 16-bit stereo
      </p>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </section>
  );
}
