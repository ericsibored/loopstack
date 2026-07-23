import { MAX_LAYERS } from '../../audio-engine/constants';
import { useProjectStore } from '../../store/projectStore';
import { TrackRow } from './TrackRow';

export function TrackList() {
  const tracks = useProjectStore((s) => s.tracks);

  if (tracks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-edge p-6 text-center text-sm text-ink-dim">
        No layers yet. Your first take sets the loop length — everything after
        it locks to that.
      </p>
    );
  }

  return (
    <>
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-ink-dim">Layers</h2>
        <span className="font-mono text-xs text-ink-dim">
          {tracks.length}/{MAX_LAYERS}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {tracks.map((track, index) => (
          <TrackRow
            key={track.id}
            track={track}
            isFirst={index === 0}
            isLast={index === tracks.length - 1}
          />
        ))}
      </ul>
    </>
  );
}
