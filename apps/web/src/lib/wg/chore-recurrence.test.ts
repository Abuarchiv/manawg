import { describe, expect, it } from 'vitest';
import { computeNextDueAt } from './chore-recurrence';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('computeNextDueAt', () => {
	it('advances by intervalDays when completed exactly on time (weekly)', () => {
		const prevDueAt = new Date('2026-05-01T08:00:00Z');
		const completedAt = new Date('2026-05-01T08:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 7, completedAt);

		expect(nextDueAt.toISOString()).toBe('2026-05-08T08:00:00.000Z');
	});

	it('keeps the cadence stable when completed 5 days early (monthly)', () => {
		// Bug regression: previously this anchored on Date.now() and slid the
		// next-due 5 days earlier — over 12 cycles that drifts ~60 days off.
		const prevDueAt = new Date('2026-06-15T00:00:00Z');
		const completedAt = new Date('2026-06-10T00:00:00Z'); // 5 days early

		const nextDueAt = computeNextDueAt(prevDueAt, 30, completedAt);

		// Anchor stays on prevDueAt, not completedAt → cadence preserved.
		expect(nextDueAt.toISOString()).toBe('2026-07-15T00:00:00.000Z');
		expect(nextDueAt.getTime() - prevDueAt.getTime()).toBe(30 * MS_PER_DAY);
	});

	it('reschedules from "now" when massively overdue (10 days late)', () => {
		// If we anchored on prevDueAt alone, the next-due would be in the
		// past — useless. Clamp to completedAt so the cadence resumes from
		// today.
		const prevDueAt = new Date('2026-05-01T00:00:00Z');
		const completedAt = new Date('2026-05-11T00:00:00Z'); // 10 days late

		const nextDueAt = computeNextDueAt(prevDueAt, 7, completedAt);

		expect(nextDueAt.toISOString()).toBe('2026-05-18T00:00:00.000Z');
		expect(nextDueAt.getTime() - completedAt.getTime()).toBe(7 * MS_PER_DAY);
	});

	it('does not advance the due date for one-shot chores (intervalDays = 0)', () => {
		// The DB column is notNull default 7 and the create-route Zod schema
		// enforces min(1), so 0 is not reachable through the API today. We
		// still defend the helper so a future schema change cannot silently
		// rotate one-shot chores forever.
		const prevDueAt = new Date('2026-05-01T00:00:00Z');
		const completedAt = new Date('2026-05-03T00:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 0, completedAt);

		expect(nextDueAt.toISOString()).toBe(prevDueAt.toISOString());
	});

	it('treats negative or NaN intervalDays as one-shot (defensive)', () => {
		const prevDueAt = new Date('2026-05-01T00:00:00Z');
		const completedAt = new Date('2026-05-03T00:00:00Z');

		expect(computeNextDueAt(prevDueAt, -3, completedAt).toISOString()).toBe(
			prevDueAt.toISOString(),
		);
		expect(computeNextDueAt(prevDueAt, Number.NaN, completedAt).toISOString()).toBe(
			prevDueAt.toISOString(),
		);
	});

	it('returns a fresh Date instance (no aliasing of prevDueAt)', () => {
		const prevDueAt = new Date('2026-05-01T00:00:00Z');
		const completedAt = new Date('2026-05-01T00:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 7, completedAt);

		expect(nextDueAt).not.toBe(prevDueAt);
	});

	// ─── calendar-month recurrence (recurrenceType = 'months') ──────────────
	//
	// Bug history #2 fix: 12 × intervalDays=30 = 360 days, so a "monthly"
	// chore drifts ~5 days off-cadence per year. The 'months' branch uses
	// Date.setMonth so the cadence stays calendar-accurate.

	it("advances by exactly one calendar month for recurrenceType='months'", () => {
		const prevDueAt = new Date('2026-01-15T08:00:00Z');
		const completedAt = new Date('2026-01-15T08:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 1, completedAt, 'months');

		// Same day-of-month, next calendar month — not +30 days (which would
		// have landed on 2026-02-14).
		expect(nextDueAt.toISOString()).toBe('2026-02-15T08:00:00.000Z');
	});

	it('clamps month-end overflow to last day of target month (non-leap)', () => {
		// Jan 31 + 1 month: naive setMonth overflows to Mar 3. We clamp to
		// Feb 28 because 2026 is not a leap year.
		const prevDueAt = new Date('2026-01-31T12:00:00Z');
		const completedAt = new Date('2026-01-31T12:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 1, completedAt, 'months');

		expect(nextDueAt.toISOString()).toBe('2026-02-28T12:00:00.000Z');
	});

	it('clamps month-end overflow to Feb 29 in a leap year', () => {
		const prevDueAt = new Date('2024-01-31T12:00:00Z');
		const completedAt = new Date('2024-01-31T12:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 1, completedAt, 'months');

		expect(nextDueAt.toISOString()).toBe('2024-02-29T12:00:00.000Z');
	});

	it('12 months from 2026-01-15 lands on 2027-01-15 exactly (no day drift)', () => {
		// Regression for the 12×30=360 drift bug. The 'days' branch would
		// give us 2026-12-31 (-15 days early); 'months' gives the exact
		// same calendar day a year later.
		const prevDueAt = new Date('2026-01-15T00:00:00Z');
		const completedAt = new Date('2026-01-15T00:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 12, completedAt, 'months');

		expect(nextDueAt.toISOString()).toBe('2027-01-15T00:00:00.000Z');
	});

	it('clamps to completedAt when overdue (months branch matches days clamp)', () => {
		// Monthly chore originally due Jan 15, but actually completed 10
		// days late on Jan 25. The next due anchors on completedAt (max
		// branch), so the next due is Feb 25 — not Feb 15.
		const prevDueAt = new Date('2026-01-15T00:00:00Z');
		const completedAt = new Date('2026-01-25T00:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 1, completedAt, 'months');

		expect(nextDueAt.toISOString()).toBe('2026-02-25T00:00:00.000Z');
	});

	it('keeps cadence stable when completed early in the months branch', () => {
		// Monthly chore due Feb 1, completed 5 days early on Jan 27 — the
		// next due should still anchor on prevDueAt (Feb 1) + 1 month = Mar
		// 1, NOT completedAt + 1 month = Feb 27.
		const prevDueAt = new Date('2026-02-01T00:00:00Z');
		const completedAt = new Date('2026-01-27T00:00:00Z');

		const nextDueAt = computeNextDueAt(prevDueAt, 1, completedAt, 'months');

		expect(nextDueAt.toISOString()).toBe('2026-03-01T00:00:00.000Z');
	});

	it('treats 0 / negative / NaN as one-shot regardless of recurrenceType', () => {
		const prevDueAt = new Date('2026-05-01T00:00:00Z');
		const completedAt = new Date('2026-05-03T00:00:00Z');

		expect(computeNextDueAt(prevDueAt, 0, completedAt, 'months').toISOString()).toBe(
			prevDueAt.toISOString(),
		);
		expect(computeNextDueAt(prevDueAt, -1, completedAt, 'months').toISOString()).toBe(
			prevDueAt.toISOString(),
		);
		expect(computeNextDueAt(prevDueAt, Number.NaN, completedAt, 'months').toISOString()).toBe(
			prevDueAt.toISOString(),
		);
	});

	it("defaults to 'days' when recurrenceType is omitted (backward-compat)", () => {
		const prevDueAt = new Date('2026-01-15T00:00:00Z');
		const completedAt = new Date('2026-01-15T00:00:00Z');

		const explicitDays = computeNextDueAt(prevDueAt, 30, completedAt, 'days');
		const omitted = computeNextDueAt(prevDueAt, 30, completedAt);

		expect(omitted.toISOString()).toBe(explicitDays.toISOString());
	});
});
