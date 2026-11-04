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
	asOf: '2026-10-02T08:00:00Z',
	members: [
		{ id: 'a', name: 'Lina', paidCents: 10000, shareCents: 4000 },
		{ id: 'b', name: 'Jonas', paidCents: 2345, shareCents: 8345 },
	],
	open: [
		{ memberId: 'a', name: 'Lina', currency: 'EUR', cents: 6000 },
		{ memberId: 'b', name: 'Jonas', currency: 'EUR', cents: -6000 },
	],
	transfers: [
		{ fromId: 'b', toId: 'a', fromName: 'Jonas', toName: 'Lina', cents: 6000, currency: 'EUR' },
	],
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

test('the settings footer link opens the Notifications tab, in HTML and plain text', () => {
	const mail = renderStatementMail(base);
	assert.ok(mail.html.includes(`/wg/${base.shareCode}/settings#notifications`));
	assert.ok(mail.text.includes(`/wg/${base.shareCode}/settings#notifications`));
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

test('the mail says the statement is attached, in HTML and plain text', () => {
	const de = renderStatementMail(base);
	assert.ok(de.text.includes('Die Abrechnung als PDF hängt an.'));
	assert.ok(de.html.includes('Die Abrechnung als PDF hängt an.'));
	const en = renderStatementMail({ ...base, locale: 'en' });
	assert.ok(en.text.includes('The statement is attached as a PDF.'));
	assert.ok(en.html.includes('The statement is attached as a PDF.'));
});

test('without a PDF the mail does not claim an attachment', () => {
	const mail = renderStatementMail({ ...base, withPdf: false });
	assert.ok(!mail.text.includes('PDF'));
	assert.ok(!mail.html.includes('PDF'));
});

const multi: MonthlyStatement = {
	...statement,
	open: [
		{ memberId: 'a', name: 'Lina', currency: 'EUR', cents: -1500 },
		{ memberId: 'b', name: 'Jonas', currency: 'EUR', cents: 1500 },
		{ memberId: 'a', name: 'Lina', currency: 'USD', cents: 2000 },
		{ memberId: 'b', name: 'Jonas', currency: 'USD', cents: -2000 },
		{ memberId: 'c', name: 'Mira', currency: 'CHF', cents: 700 },
		{ memberId: 'b', name: 'Jonas', currency: 'CHF', cents: -700 },
	],
	transfers: [
		{ fromId: 'a', toId: 'b', fromName: 'Lina', toName: 'Jonas', cents: 1500, currency: 'EUR' },
		{ fromId: 'b', toId: 'a', fromName: 'Jonas', toName: 'Lina', cents: 2000, currency: 'USD' },
		{ fromId: 'b', toId: 'c', fromName: 'Jonas', toName: 'Mira', cents: 700, currency: 'CHF' },
	],
};

test('a member who owes in one currency and is owed in another gets one line per currency', () => {
	const mail = renderStatementMail({ ...base, statement: multi, locale: 'en' });
	const lines = mail.text.split('\n');
	assert.ok(lines.includes('You owe: €15.00'));
	assert.ok(lines.includes('You are owed: +US$20.00'));
	assert.ok(lines.includes('  to Jonas €15.00'));
	assert.ok(lines.includes('  from Jonas US$20.00'));
	assert.ok(!mail.text.includes('Mira'));
	assert.ok(!mail.text.includes('CHF'));
	assert.equal(mail.preheader, '2 people, 2 expenses, open amounts in several currencies.');
	assert.equal((mail.html.match(/You owe|You are owed/g) ?? []).length, 2);
});

test('transfer lines name only the transfers the recipient is part of', () => {
	const mail = renderStatementMail({ ...base, statement: multi, memberId: 'c', locale: 'en' });
	assert.ok(mail.text.includes('You are owed: +CHF'));
	assert.ok(mail.text.includes('  from Jonas'));
	assert.ok(!mail.text.includes('Lina'));
});

test('a recipient without an open balance sees the settled segment', () => {
	const mail = renderStatementMail({ ...base, statement: multi, memberId: 'z' });
	assert.match(mail.text, /^Alles ausgeglichen: 0,00\s€$/m);
	assert.ok(!mail.text.includes('Du bekommst'));
	assert.match(mail.html, /Alles ausgeglichen/);
});
