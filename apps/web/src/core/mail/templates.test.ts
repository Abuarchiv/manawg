import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { formatEuroCents } from '@/core/utils/money';
import { APP_ORIGIN } from './brand-mail';
import { MAIL_DARK_STYLE } from './dark-mode';
import {
	renderAccountDeletedMail,
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
		inviteToken: 'aB3_-xYz09aB3_-xYz09kQ',
		memberNames: ['Lina', 'Jonas', 'Mira'],
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
		unsubscribeUrl: `${APP_ORIGIN}/api/email/unsubscribe?t=y`,
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

test('invitation carries the invitation link, its lifetime and who is already in', () => {
	const mail = ALL[1];
	assert.ok(mail);
	assert.equal(mail.subject, 'Lina lädt dich in die WG Kastanienallee ein');
	assert.ok(mail.text.includes(`${APP_ORIGIN}/einladung/aB3_-xYz09aB3_-xYz09kQ`));
	assert.ok(!mail.text.includes('KST48210'));
	assert.ok(mail.text.includes('Der Link gilt 7 Tage.'));
	assert.ok(mail.text.includes('Lina, Jonas und Mira sind schon dabei.'));
	assert.ok(mail.text.includes('wir speichern sie nicht weiter'));
});

test('reminder names the creditor and amount in the subject and lists the items', () => {
	const mail = ALL[2];
	assert.ok(mail);
	assert.equal(mail.subject, `Noch offen bei Jonas: ${formatEuroCents(2340)}`);
	assert.equal(mail.preheader, 'Ältester Posten 9 Tage alt.');
	assert.ok(mail.text.includes(`Einkauf Edeka (25.09.) ${formatEuroCents(1420)}`));
	assert.ok(mail.html.includes('#E7000B'), 'owed amount uses the debt colour');
	assert.ok(mail.text.includes(`Abbestellen: ${APP_ORIGIN}/api/email/unsubscribe?t=y`));
});

test('welcome without a name still greets and lists the three steps', () => {
	const mail = renderWelcomeMail({ firstName: null });
	assert.ok(mail.text.includes('Dein Konto ist bereit.'));
	assert.ok(mail.text.includes('3. Erste Ausgabe eintragen'));
	assert.ok(mail.text.includes(`WG einrichten: ${APP_ORIGIN}/neu`));
});

test('html escapes user supplied names', () => {
	const mail = renderInvitationMail({
		inviterName: '<b>Eve</b>',
		wgName: 'WG & Co',
		inviteToken: 'aB3_-xYz09aB3_-xYz09kQ',
		memberNames: ['<b>Eve</b>'],
	});
	assert.ok(!mail.html.includes('<b>Eve</b>'));
	assert.ok(mail.html.includes('&lt;b&gt;Eve&lt;/b&gt;'));
	assert.ok(mail.html.includes('WG &amp; Co'));
});

test('every mail renders a dark mode: colour-scheme meta, dark block, both mark images', () => {
	for (const mail of ALL) {
		assert.ok(mail.html.includes('content="light dark"'), mail.subject);
		assert.ok(mail.html.includes(MAIL_DARK_STYLE), mail.subject);
		assert.ok(mail.html.includes('manawg-mark-96-light.png'), mail.subject);
	}
});

test('the Supabase auth templates carry the same dark block as the app mails', () => {
	const dir = new URL('../../../../../supabase/templates/', import.meta.url);
	for (const name of readdirSync(dir).filter((file) => file.endsWith('.html'))) {
		const html = readFileSync(new URL(name, dir), 'utf8');
		assert.ok(html.includes(MAIL_DARK_STYLE), name);
		assert.ok(html.includes('content="light dark"'), name);
		assert.ok(html.includes('manawg-mark-96-light.png'), name);
	}
});

test('the farewell mail states what is removed and that the name stays in WG entries', () => {
	const { text } = renderAccountDeletedMail();
	assert.match(text, /Login sowie deine Push- und Kalender-Abos sind entfernt/);
	assert.match(text, /Dein Name bleibt in den bisherigen Einträgen/);
	assert.ok(!text.includes('Anhänge'));
});

test('reminder mail explains items that do not add up to the netted amount', () => {
	const input = {
		wgName: 'Kastanienallee',
		shareCode: 'KST48210',
		creditorName: 'Jonas',
		oldestDebtAgeDays: 9,
		items: [
			{ description: 'Einkauf Edeka', date: '25.09.', cents: 1420 },
			{ description: 'Klopapier', date: '30.09.', cents: 920 },
		],
		unsubscribeUrl: `${APP_ORIGIN}/api/email/unsubscribe?t=y`,
	};
	assert.ok(!renderReminderMail({ ...input, amountCents: 2340 }).text.includes('verrechnet'));
	assert.ok(renderReminderMail({ ...input, amountCents: 1000 }).text.includes('verrechnet'));
});
