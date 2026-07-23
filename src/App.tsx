/**
 * App shell.
 *
 * Two tabs: Loop (record and mix) and Input (check the mic before committing a
 * take). The record button stays pinned below both — walking away from the
 * input meter to find it, or losing the meter the moment you start playing,
 * would defeat the point of having it.
 *
 * The Phase 0 bench is still at `?bench`, lazily loaded so neither its code nor
 * its stylesheet touches the normal path.
 */

import { lazy, Suspense, useState } from 'react';
import { ExportPanel } from './components/Export/ExportPanel';
import { Footer } from './components/Footer';
import { InputPanel } from './components/Input/InputPanel';
import { TrackList } from './components/Mixer/TrackList';
import { RecordButton } from './components/Record/RecordButton';
import { GridBar } from './components/Transport/GridBar';
import { TransportBar } from './components/Transport/TransportBar';
import { projectActions, useProjectStore } from './store/projectStore';

const SpikeHarness = lazy(() =>
  import('./dev/SpikeHarness').then((m) => ({ default: m.SpikeHarness })),
);

type Tab = 'loop' | 'input';

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
  const [tab, setTab] = useState<Tab>('loop');

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col gap-3 p-3">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Loopstack</h1>
        <a href="?bench" className="text-xs text-ink-dim underline">
          bench
        </a>
      </header>

      <nav className="flex gap-1 rounded-lg border border-edge bg-surface-raised p-1" role="tablist">
        <TabButton active={tab === 'loop'} onClick={() => setTab('loop')} label="Loop" />
        <TabButton active={tab === 'input'} onClick={() => setTab('input')} label="Input" />
      </nav>

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
        {tab === 'loop' ? (
          <>
            <TransportBar />
            <GridBar />
            <TrackList />
            <ExportPanel />
          </>
        ) : (
          <InputPanel />
        )}
      </div>

      <div className="pt-1">
        <RecordButton />
      </div>

      <Footer />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-10 flex-1 rounded-md text-sm font-medium ${
        active ? 'bg-accent text-surface' : 'text-ink-dim'
      }`}
    >
      {label}
    </button>
  );
}
