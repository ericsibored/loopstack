/**
 * Engine-wide constants. Anything the UI also needs to respect (e.g. the layer
 * cap) lives here so there is exactly one definition to change.
 */

/** Max simultaneous layers (PRD FR-2a). Raising this should be a one-line change. */
export const MAX_LAYERS = 4;

/** How far ahead of `currentTime` the scheduler commits audio events, in seconds. */
export const SCHEDULE_AHEAD_SEC = 0.2;

/** How often the scheduler wakes up to look ahead, in milliseconds. */
export const LOOKAHEAD_INTERVAL_MS = 25;

/**
 * Small delay applied when starting the transport, so the first loop boundary is
 * comfortably in the future rather than racing `currentTime`.
 */
export const TRANSPORT_START_DELAY_SEC = 0.1;

/** rnnoise operates on fixed 480-sample frames at 48 kHz. Both are model constraints. */
export const RNNOISE_FRAME_SIZE = 480;
export const RNNOISE_SAMPLE_RATE = 48000;

/** Default search window for auto-align cross-correlation, in milliseconds (§6.3). */
export const DEFAULT_ALIGN_SEARCH_MS = 200;
