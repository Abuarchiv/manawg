import assert from 'node:assert/strict';
import test from 'node:test';
import { planStatementMails, type StatementWgMember } from './statement-recipients';

const member = (id: string, overrides: Partial<StatementWgMember> = {}): StatementWgMember => ({
	id,
	name: id,
	active: true,
	notify: true,
	email: `${id.toLowerCase()}@example.org`,
	...overrides,
});

function expense(paidBy: string, shares: Record<string, number>, currency = 'EUR') {
	return {
		id: `${paidBy}-${Object.keys(shares).join('')}`,
		paidByMemberId: paidBy,
		amountCents: Object.values(shares).reduce((sum, cents) => sum + cents, 0),
		currency,
		description: 'x',
		occurredAt: '2026-09-10T10:00:00Z',
		splits: Object.entries(shares).map(([debtorMemberId, amountCents]) => ({
			debtorMemberId,
			amountCents,
			settledAt: null,
		})),
	};
}

const reasons = (plan: ReturnType<typeof planStatementMails>) =>
	Object.fromEntries(plan.skipped.map((skip) => [skip.memberId, skip.reason]));

test('mails every participant of a normal month and records the others as skipped', () => {
	const plan = planStatementMails(
		[
			member('L'),
			member('J'),
			member('N'), // took no part
			member('O', { notify: false }),
			member('P', { email: null }),
			member('Q', { active: false }),
		],
		[expense('L', { L: 500, J: 500, O: 500, P: 500, Q: 500 })],
		'2026-09',
	);
	assert.deepEqual(plan.recipients.map((r) => r.memberId).sort(), ['J', 'L']);
	assert.deepEqual(reasons(plan), {
		N: 'not_participant',
		O: 'opted_out',
		P: 'no_email',
		Q: 'inactive',
	});
});

test('a quiet month or one without EUR expenses mails nobody and records nothing', () => {
	const members = [member('L'), member('J')];
	assert.deepEqual(planStatementMails(members, [], '2026-09'), { recipients: [], skipped: [] });
	const usd = planStatementMails(members, [expense('L', { L: 500, J: 500 }, 'USD')], '2026-09');
	assert.deepEqual(usd, { recipients: [], skipped: [] });
});

test('a single participant mails nobody', () => {
	const plan = planStatementMails(
		[member('L'), member('J')],
		[expense('L', { L: 1000 })],
		'2026-09',
	);
	assert.equal(plan.recipients.length, 0);
	assert.deepEqual(reasons(plan), { L: 'single_participant', J: 'single_participant' });
});

test('a moved-out member still counts as participant for the others', () => {
	const plan = planStatementMails(
		[member('L'), member('M', { active: false })],
		[expense('M', { L: 500, M: 500 })],
		'2026-09',
	);
	assert.deepEqual(
		plan.recipients.map((r) => r.memberId),
		['L'],
	);
	assert.deepEqual(reasons(plan), { M: 'inactive' });
});

test('expenses of other months are ignored', () => {
	const plan = planStatementMails(
		[member('L'), member('J')],
		[expense('L', { L: 5, J: 5 })],
		'2026-08',
	);
	assert.deepEqual(plan, { recipients: [], skipped: [] });
});

test('a member whose address lookup failed is neither mailed nor skipped', () => {
	const plan = planStatementMails(
		[member('A'), member('B'), member('C', { email: null, lookupFailed: true })],
		[expense('A', { A: 500, B: 500, C: 500 })],
		'2026-09',
	);
	assert.deepEqual(
		plan.recipients.map((recipient) => recipient.memberId),
		['A', 'B'],
	);
	assert.deepEqual(plan.skipped, []);
});
