/**
 * Usage guidance.
 *
 * Headphones are the single biggest quality win in a loop-over-speakers setup:
 * without them every overdub re-records the layers underneath it, so by layer
 * four the first take has been through the mic three times, each pass adding
 * room and noise. Echo cancellation reduces the bleed but does not remove it.
 *
 * The exception is calibration, which measures the speaker→mic round trip and
 * therefore needs the sound to physically travel. Saying so here saves the user
 * a failed measurement they would otherwise have no way to explain.
 */

export function Footer() {
  return (
    <footer className="border-t border-edge pt-2 pb-1 text-[11px] leading-relaxed text-ink-dim">
      <p>
        <span aria-hidden="true">🎧</span>{' '}
        <strong className="font-medium text-ink">Use headphones or earbuds.</strong>{' '}
        Playing loops through a speaker means each overdub re-records the layers
        underneath it, and that bleed builds up with every layer.
      </p>
      <p className="mt-1">
        Recording an instrument through a speaker or amp? Keep the Input tab on{' '}
        <strong className="font-medium text-ink">Instrument</strong> — the
        browser&rsquo;s speech processing can silence a held note while still
        passing voice.
      </p>
      <p className="mt-1">
        One exception to headphones: <em>Calibrate latency</em> measures the
        speaker&rarr;mic round trip, so take them off for that step only.
      </p>
    </footer>
  );
}
