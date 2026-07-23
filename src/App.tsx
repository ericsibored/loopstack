/**
 * App shell. The Phase 0 bench is still reachable at `?bench` and is lazily
 * loaded so neither its code nor its stylesheet touches the normal path.
 */

import { lazy, Suspense } from 'react';
import { ExportPanel } from './components/Export/ExportPanel';
import { Footer } from './components/Footer';
import { TrackList } from './components/Mixer/TrackList';
import { RecordButton } from './components/Record/RecordButton';
import { GridBar } from './components/Transport/GridBar';
import { TransportBar } from './components/Transport/TransportBar';
import { projectActions, useProjectStore } from './store/projectStore';

const SpikeHarness = lazy(() =>
  import('./dev/SpikeHarness').then((m) => ({ default: m.SpikeHarness })),
);

export default function App() {
  const showBench =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('bench');

  if (showBench) {
    return (
      <Suspense fallback={<p className="p-4 text-sm">Loading bench…</p>}>
        <SpikeHarness />
      </Suspense>
    );
  }

  return <Looper />;
}

function Looper() {
  const error = useProjectStore((s) => s.error);
  const status = useProjectStore((s) => s.status);

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-3 p-3">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Loopstack</h1>
        <a href="?bench" className="text-xs text-ink-dim underline">
          bench
        </a>
      </header>

      <TransportBar />
      <GridBar />

      {error ? (
        <button
          onClick={() => projectActions.clearError()}
          className="rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-left text-xs text-red-300"
        >
          {error} — tap to dismiss
        </button>
      ) : (
        status && (
          <button
            onClick={() => projectActions.clearError()}
            className="rounded-lg border border-edge bg-surface-raised p-2 text-left text-xs text-ink-dim"
          >
            {status}
          </button>
        )
      )}

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        <TrackList />
        <ExportPanel />
      </div>

      <div className="pt-1">
        <RecordButton />
      </div>

      <Footer />
    </div>
  );
}
