/**
 * Class strings that appeared verbatim in four or more places.
 *
 * Each of these was a 150-250 character literal repeated across files, which
 * is a large part of why the page components read as walls of text. Naming
 * them means the markup shows *what* an element is rather than how it is
 * painted, and a visual change lands in one place instead of nine.
 *
 * Deliberately plain strings, not a styling abstraction: compose with a
 * template literal where an element needs extra classes.
 */

/** Focus ring shared by every interactive element. */
const FOCUS_RING_ONLY =
	'focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2';
const FOCUS_RING = `focus-visible:outline-none ${FOCUS_RING_ONLY}`;

/** Full-width text input / select / datetime field. */
export const FIELD_INPUT = `block h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-base outline-none transition-colors focus-visible:border-[var(--accent)] ${FOCUS_RING_ONLY}`;

/** Inline error / alert box. */
export const ALERT_DANGER =
	'rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]';

/** Error box that also holds an action on the right. */
export const ALERT_DANGER_ROW = `flex flex-wrap items-center justify-between gap-3 ${ALERT_DANGER}`;

/** Bordered list container whose rows are separated by hairlines. */
export const LIST_CARD =
	'divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-base)]';

/** Square icon-only button, no border. */
export const ICON_BUTTON = `inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-3)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text-1)] ${FOCUS_RING}`;

/** Square icon-only button with a border, used in toolbars. */
export const ICON_BUTTON_BORDERED = `inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-50`;

/** Pill-shaped secondary button, e.g. filter chips. */
export const CHIP_BUTTON = `inline-flex h-11 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[12px] font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-1)] ${FOCUS_RING}`;

/** Dashed placeholder shown where a list has no entries yet. */
export const EMPTY_PLACEHOLDER =
	'rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-3)]';

// TEXT_LINK moved to @manawg/shared/lib/text-link — the legal pages that use
// it now live in apps/landing, so the class string can't stay app-local.
