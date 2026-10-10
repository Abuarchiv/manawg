import assert from 'node:assert/strict';
import test from 'node:test';
import { formatEuroCents } from '@/core/utils/money';
import {
	renderAccountDeletedMail,
	renderDigestMail,
	renderInvitationMail,
	renderReminderMail,
	renderWelcomeMail,
} from './templates';

// Touchpoints rules: one thought per mail, no exclamation mark, amounts in the text, button present.

const ALL = [
	renderWelcomeMail({ firstName: 'Lina' }),
	renderInvitationMail({
		inviterName: 'Lina',
		wgName: 'Kastanienallee',
		shareCode: 'KST48210',
		memberNames: ['Lina', 'Jonas', 'Mira'],
	}),
	renderDigestMail({
		wgName: 'Kastanienallee',
		shareCode: 'KST48210',
		dayLabel: 'Sa. · 04.10.',
		items: [
			{ label: 'Putzplan', text: 'Bad ist heute dran.' },
			{ label: 'Ausgabe', text: 'Lina hat den Einkauf eingetragen.', value: '18,90 €' },
		],
		unsubscribeUrl: 'https://app.manawg.com/api/email/unsubscribe?t=x',
	}),
	renderReminderMail({
		wgName: 'Kastanienallee',
		shareCode: 'KST48210',
		creditorName: 'Jonas',
		amountCents: 2340,
		oldestDebtAgeDays: 9,
		items: [
			{ description: 'Einkauf Edeka', date: '25.09.', cents: 1420 },
			{ description: 'Klopapier', date: '30.09.', cents: 920 },
		],
		unsubscribeUrl: 'https://app.manawg.com/api/email/unsubscribe?t=y',
	}),
	renderAccountDeletedMail(),
];

test('no mail shouts: subjects and texts carry no exclamation mark', () => {
	for (const mail of ALL) {
		assert.ok(!mail.subject.includes('!'), mail.subject);
		assert.ok(!mail.text.includes('!'), mail.subject);
	}
});

test('every mail renders HTML and text with the same title and footer reason', () => {
	for (const mail of ALL) {
		assert.match(mail.html, /<!DOCTYPE html>/);
		assert.ok(mail.html.includes('manawg-mark-96.png'), 'mark in the head');
		assert.ok(mail.text.length > 40);
	}
});

test('invitation carries code, join link and who is already in', () => {
	const mail = ALL[1];
	assert.ok(mail);
	assert.equal(mail.subject, 'Lina lädt dich in die WG Kastanienallee ein');
	assert.ok(mail.html.includes('KST48210'));
	assert.ok(mail.text.includes('https://app.manawg.com/?code=KST48210'));
	assert.ok(mail.text.includes('Lina, Jonas und Mira sind schon dabei.'));
	assert.ok(mail.text.includes('wir speichern sie nicht weiter'));
});

test('reminder names the creditor and amount in the subject and lists the items', () => {
	const mail = ALL[3];
	assert.ok(mail);
	assert.equal(mail.subject, `Noch offen bei Jonas: ${formatEuroCents(2340)}`);
	assert.equal(mail.preheader, 'Ältester Posten 9 Tage alt.');
	assert.ok(mail.text.includes(`Einkauf Edeka (25.09.) ${formatEuroCents(1420)}`));
	assert.ok(mail.html.includes('#E7000B'), 'owed amount uses the debt colour');
	assert.ok(mail.text.includes('Abbestellen: https://app.manawg.com/api/email/unsubscribe?t=y'));
});

test('digest subject names the WG and the preheader summarises the first items', () => {
	const mail = ALL[2];
	assert.ok(mail);
	assert.equal(mail.subject, 'Heute in der Kastanienallee');
	assert.equal(mail.preheader, 'Bad ist heute dran, Lina hat den Einkauf eingetragen.');
	assert.ok(mail.text.includes('18,90 €'));
});

test('welcome without a name still greets and lists the three steps', () => {
	const mail = renderWelcomeMail({ firstName: null });
	assert.ok(mail.text.includes('Dein Konto ist bereit.'));
	assert.ok(mail.text.includes('3. Erste Ausgabe eintragen'));
	assert.ok(mail.text.includes('WG einrichten: https://app.manawg.com/neu'));
});

test('html escapes user supplied names', () => {
	const mail = renderInvitationMail({
		inviterName: '<b>Eve</b>',
		wgName: 'WG & Co',
		shareCode: 'ABCD1234',
		memberNames: ['<b>Eve</b>'],
	});
	assert.ok(!mail.html.includes('<b>Eve</b>'));
	assert.ok(mail.html.includes('&lt;b&gt;Eve&lt;/b&gt;'));
	assert.ok(mail.html.includes('WG &amp; Co'));
});
