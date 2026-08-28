import { describe, expect, it } from 'vitest';
import { REMINDER_COOLDOWN_HOURS, canSendReminder, formatReminderMessage } from './reminders';

const HOUR_MS = 3_600_000;

describe('canSendReminder', () => {
	it('allows the first reminder when history is empty', () => {
		const result = canSendReminder('ben', 'alice', [], new Date('2026-05-23T12:00:00.000Z'));
		expect(result.allowed).toBe(true);
		expect(result.cooldownMs).toBe(0);
		expect(result.lastSentAt).toBeNull();
	});

	it('blocks within the cooldown window for the same pair', () => {
		const now = new Date('2026-05-23T12:00:00.000Z');
		const recent = new Date(now.getTime() - 12 * HOUR_MS).toISOString();
		const result = canSendReminder(
			'ben',
			'alice',
			[{ debtorMemberId: 'ben', creditorMemberId: 'alice', sentAt: recent }],
			now,
		);
		expect(result.allowed).toBe(false);
		expect(result.cooldownMs).toBeGreaterThan(0);
		expect(result.nextAllowedAt).not.toBeNull();
	});

	it('allows after the cooldown elapses', () => {
		const now = new Date('2026-05-23T12:00:00.000Z');
		const oldEnough = new Date(
			now.getTime() - REMINDER_COOLDOWN_HOURS * HOUR_MS - HOUR_MS,
		).toISOString();
		const result = canSendReminder(
			'ben',
			'alice',
			[{ debtorMemberId: 'ben', creditorMemberId: 'alice', sentAt: oldEnough }],
			now,
		);
		expect(result.allowed).toBe(true);
		expect(result.lastSentAt).not.toBeNull();
	});

	it('ignores entries for other debtor/creditor pairs', () => {
		const now = new Date('2026-05-23T12:00:00.000Z');
		const recent = new Date(now.getTime() - HOUR_MS).toISOString();
		const result = canSendReminder(
			'ben',
			'alice',
			[
				{ debtorMemberId: 'cora', creditorMemberId: 'alice', sentAt: recent },
				{ debtorMemberId: 'ben', creditorMemberId: 'cora', sentAt: recent },
			],
			now,
		);
		expect(result.allowed).toBe(true);
	});
});

describe('formatReminderMessage', () => {
	it('formats a German reminder string with amount and age', () => {
		const message = formatReminderMessage({
			debtorName: 'Ben',
			creditorName: 'Alice',
			amountCents: 2340,
			oldestDebtAgeDays: 5,
		});
		expect(message).toContain('Alice');
		expect(message).toMatch(/23,40\s?€/);
		expect(message).toContain('seit 5 Tagen');
		expect(message).toContain('bitte zeitnah ausgleichen');
	});

	it('uses singular for 1 day', () => {
		const message = formatReminderMessage({
			debtorName: 'Ben',
			creditorName: 'Alice',
			amountCents: 500,
			oldestDebtAgeDays: 1,
		});
		expect(message).toContain('seit 1 Tag');
		expect(message).not.toContain('1 Tagen');
	});

	it('omits the age clause when zero days old', () => {
		const message = formatReminderMessage({
			debtorName: 'Ben',
			creditorName: 'Alice',
			amountCents: 100,
			oldestDebtAgeDays: 0,
		});
		expect(message).not.toContain('seit');
	});
});
