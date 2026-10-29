/** Shared by the durable server replay cache and the browser's safe retry window. */
export const RESPONSE_REPLAY_TTL_SECONDS = 7 * 24 * 60 * 60;

export const OFFLINE_REPLAY_CLOCK_SKEW_MS = 5 * 60 * 1000;
// Allow the initial online request to time out before enqueueing, plus replay transport.
// Both calls use apiFetch's 15-second deadline; leave the server retention unchanged.
export const OFFLINE_REPLAY_MAX_AGE_MS =
	RESPONSE_REPLAY_TTL_SECONDS * 1000 - OFFLINE_REPLAY_CLOCK_SKEW_MS - 2 * 15_000;

/**
 * The tap time a client reports, clamped to the offline replay window so a queued action
 * keeps its real time but a wrong device clock cannot reach into the future or the far past.
 */
export function clampTapTime(tapAt: Date, now: number): Date {
	return new Date(Math.min(now, Math.max(now - OFFLINE_REPLAY_MAX_AGE_MS, tapAt.getTime())));
}
