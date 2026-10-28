import assert from 'node:assert/strict';
import test from 'node:test';
import type { MonthlyStatement } from './monthly-statement';
import { renderStatementMail } from './statement-mail';

const statement: MonthlyStatement = {
	monthKey: '2026-09',
	totalCents: 12345,
	items: [{}, {}] as unknown as MonthlyStatement['items'],
	categories: [],
	settled: false,
	members: [
		{ id: 'a', name: 'Lina', paidCents: 10000, shareCents: 4000, balanceCents: 6000 },
		{ id: 'b', name: 'Jonas', paidCents: 2345, shareCents: 8345, balanceCents: -6000 },
	],
	transfers: [{ fromId: 'b', toId: 'a', fromName: 'Jonas', toName: 'Lina', cents: 6000 }],
};
const base = {
	wgName: 'Kastanienallee',
	shareCode: 'KST4821X',
	statement,
	memberId: 'a',
	unsubscribeUrl: 'https://app.example/unsubscribe?t=x',
};

test('the German statement mail is the default', () => {
	const mail = renderStatementMail(base);
	assert.equal(mail.subject, 'September ist abgerechnet');
	assert.match(mail.html, /<html lang="de"/);
	assert.ok(mail.text.includes('Du bekommst: +60,00 €'));
	assert.ok(mail.text.includes('  von Jonas 60,00 €'));
	assert.deepEqual(renderStatementMail({ ...base, locale: 'de' }), mail);
});

test('the English statement mail uses English words, month and amounts', () => {
	const mail = renderStatementMail({ ...base, locale: 'en' });
	assert.equal(mail.subject, 'The September statement is ready');
	assert.equal(mail.preheader, '2 people, 2 expenses, you are owed €60.00.');
	assert.match(mail.html, /<html lang="en-GB"/);
	assert.ok(mail.text.includes('You are owed: +€60.00'));
	assert.ok(mail.text.includes('  from Jonas €60.00'));
	assert.ok(mail.text.includes('Unsubscribe: https://app.example/unsubscribe?t=x'));
	assert.ok(!/Abbestellen|Einstellungen/.test(mail.html));
});
