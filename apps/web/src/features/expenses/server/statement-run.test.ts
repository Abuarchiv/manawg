import assert from 'node:assert/strict';
import test from 'node:test';
import type { StatementRecipient } from '../statement-recipients';
import { dispatchStatementBatch } from './statement-run';
import type { MailOutcome, MailTransport, OutgoingMail } from './statement-transport';

process.env.MEMBER_SESSION_SECRET = 'test-secret';
const wg = { id: 'wg', name: 'Kastanienallee', shareCode: 'KST4821X' };
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function recipient(memberId: string, email: string): StatementRecipient {
	return {
		memberId,
		name: memberId,
		email,
		statement: {
			monthKey: '2026-09',
			totalCents: 1000,
			items: [],
			categories: [],
			members: [{ id: memberId, name: memberId, paidCents: 1000, shareCents: 500 }],
			open: [],
			transfers: [],
			settled: true,
			asOf: '2026-10-02T08:00:00Z',
		},
	};
}

function fakeTransport(outcomeFor: (mail: OutgoingMail) => MailOutcome) {
	const sent: OutgoingMail[] = [];
	const deadlines: Array<number | undefined> = [];
	const transport: MailTransport = {
		name: 'dry-run',
		async sendBatch(mails, deadline) {
			deadlines.push(deadline);
			sent.push(...mails);
			return mails.map(outcomeFor);
		},
	};
	return { transport, sent, deadlines };
}

test('sent, failed, deferred and not-eligible rows each get their own state', async () => {
	const recipients = new Map([
		[ID(1), { wg, recipient: recipient(ID(1), 'ok@example.org') }],
		[ID(2), { wg, recipient: recipient(ID(2), 'bad@example.org') }],
		[ID(3), { wg, recipient: recipient(ID(3), 'later@example.org') }],
	]);
	const { transport, sent } = fakeTransport((mail) =>
		mail.to.startsWith('ok')
			? { kind: 'sent', providerId: 'p1' }
			: mail.to.startsWith('bad')
				? { kind: 'failed', error: 'http_422' }
				: { kind: 'deferred' },
	);
	const rows = [1, 2, 3, 4].map((n) => ({ id: `row${n}`, memberId: ID(n), attempts: 0 }));
	const { updates, deferred } = await dispatchStatementBatch(rows, recipients, transport);

	assert.equal(sent.length, 3);
	assert.equal(deferred, 1);
	assert.deepEqual(Object.fromEntries(updates.map((u) => [u.id, u.status])), {
		row1: 'sent',
		row2: 'failed',
		row3: 'pending',
		row4: 'skipped',
	});
	assert.equal(updates.find((u) => u.id === 'row4')?.skipReason, 'not_eligible_at_send');
});

test('a member who opted out after queueing is not mailed', async () => {
	const { transport, sent } = fakeTransport(() => ({ kind: 'sent', providerId: 'x' }));
	const { updates } = await dispatchStatementBatch(
		[{ id: 'row1', memberId: ID(1), attempts: 1 }],
		new Map(),
		transport,
	);
	assert.equal(sent.length, 0);
	assert.equal(updates[0]?.status, 'skipped');
});

test('one PDF per WG and language is attached to every mail of the run', async () => {
	const { transport, sent, deadlines } = fakeTransport(() => ({ kind: 'sent', providerId: 'x' }));
	const english = { ...recipient(ID(3), 'c@example.org'), locale: 'en' as const };
	const recipients = new Map([
		[ID(1), { wg, recipient: recipient(ID(1), 'a@example.org') }],
		[ID(2), { wg, recipient: recipient(ID(2), 'b@example.org') }],
		[ID(3), { wg, recipient: english }],
	]);
	const rows = [1, 2, 3].map((n) => ({ id: `row${n}`, memberId: ID(n), attempts: 1 }));
	await dispatchStatementBatch(rows, recipients, transport, 123_456);

	const [a, b, c] = sent.map((mail) => mail.attachments?.[0]);
	assert.ok(a && b && c);
	assert.equal(a.content, b.content);
	assert.notEqual(a.content, c.content);
	assert.deepEqual(
		[a.filename, c.filename, a.contentType],
		['ManaWG-Abrechnung-2026-09.pdf', 'ManaWG-statement-2026-09.pdf', 'application/pdf'],
	);
	assert.equal(Buffer.from(a.content.slice(0, 5)).toString('latin1'), '%PDF-');
	assert.ok(sent[0]?.text.includes('Die Abrechnung als PDF hängt an.'));
	assert.deepEqual(deadlines, [123_456]);
});

test('a statement that cannot be rendered as PDF is still mailed, without the attachment line', async () => {
	const { transport, sent } = fakeTransport(() => ({ kind: 'sent', providerId: 'x' }));
	const broken = recipient(ID(1), 'a@example.org');
	broken.statement.items = [
		{ id: 'e', occurredAt: 'not a date', description: 'x', payerName: 'a', amountCents: 100 },
	];
	const recipients = new Map([[ID(1), { wg, recipient: broken }]]);
	const { updates } = await dispatchStatementBatch(
		[{ id: 'row1', memberId: ID(1), attempts: 1 }],
		recipients,
		transport,
	);
	assert.equal(updates[0]?.status, 'sent');
	assert.equal(sent[0]?.attachments, undefined);
	assert.ok(!sent[0]?.text.includes('PDF'));
});
