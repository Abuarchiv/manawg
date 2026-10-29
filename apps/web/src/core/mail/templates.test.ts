import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { formatEuroCents } from '@/core/utils/money';
import { MAIL_DARK_STYLE } from './dark-mode';

// The mail footer links the operator's legal pages when the instance has them, read at load time.
process.env.NEXT_PUBLIC_LEGAL_URL = 'https://legal.example.test';
const { APP_ORIGIN } = await import('./brand-mail');
const { renderAccountDeletedMail, renderInvitationMail, renderReminderMail, renderWelcomeMail } =
	await import('./templates');

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
	assert.ok(mail.text.includes(`${APP_ORIGIN}/invite/aB3_-xYz09aB3_-xYz09kQ`));
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
	assert.ok(mail.text.includes(`WG einrichten: ${APP_ORIGIN}/login`));
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

test('reminder mail formats every amount in the reminder currency', () => {
	const mail = renderReminderMail({
		wgName: 'Kastanienallee',
		shareCode: 'KST48210',
		creditorName: 'Jonas',
		amountCents: 1200,
		currency: 'CHF',
		oldestDebtAgeDays: 3,
		items: [{ description: 'Fondue', date: '25.09.', cents: 1200 }],
		unsubscribeUrl: `${APP_ORIGIN}/api/email/unsubscribe?t=y`,
	});
	assert.ok(mail.subject.includes('CHF'), mail.subject);
	assert.ok(!mail.text.includes('€'), mail.text);
});

const GERMAN_WORDS =
	/\b(Einladung|Erinnerung|Konto|Dein|Deine|Abbestellen|Einstellungen|ausgleichen)\b/;

const ALL_EN = [
	renderWelcomeMail({ firstName: 'Lina', locale: 'en' }),
	renderInvitationMail({
		inviterName: 'Lina',
		wgName: 'Kastanienallee',
		inviteToken: 'aB3_-xYz09aB3_-xYz09kQ',
		memberNames: ['Lina', 'Jonas', 'Mira'],
		locale: 'en',
	}),
	renderReminderMail({
		wgName: 'Kastanienallee',
		shareCode: 'KST48210',
		creditorName: 'Jonas',
		amountCents: 2340,
		oldestDebtAgeDays: 9,
		items: [{ description: 'Einkauf Edeka', date: '25 Sept', cents: 1420 }],
		unsubscribeUrl: `${APP_ORIGIN}/api/email/unsubscribe?t=y`,
		locale: 'en',
	}),
	renderAccountDeletedMail('en'),
];

test('English mails set lang en-GB and carry no German chrome', () => {
	for (const mail of ALL_EN) {
		assert.match(mail.html, /<html lang="en-GB"/);
		assert.ok(!GERMAN_WORDS.test(mail.text), mail.subject);
		assert.ok(!mail.subject.includes('!'), mail.subject);
	}
	assert.ok(ALL_EN.every((mail) => /Legal notice|last email/.test(mail.html + mail.text)));
});

test('English invitation and reminder use the English wording and formats', () => {
	const [, invitation, reminder] = ALL_EN;
	assert.equal(invitation?.subject, 'Lina has invited you to join Kastanienallee');
	assert.ok(invitation?.text.includes('Lina, Jonas and Mira are already members.'));
	assert.equal(
		reminder?.subject,
		`${formatEuroCents(2340, 'EUR', { locale: 'en' })} to Jonas, still open`,
	);
	assert.equal(reminder?.preheader, 'The oldest item is 9 days old.');
	assert.ok(reminder?.text.includes('−€23.40'));
});

test('the invitation caption lists three names and counts the rest once', () => {
	const input = {
		inviterName: 'Lina',
		wgName: 'Kastanienallee',
		inviteToken: 'tok',
		memberNames: ['Lina', 'Jonas', 'Mira', 'Sam', 'Alex'],
	};
	assert.ok(
		renderInvitationMail({ ...input, locale: 'en' }).text.includes(
			'Lina, Jonas, Mira and 2 more are already members.',
		),
	);
	assert.ok(
		renderInvitationMail({ ...input, locale: 'de' }).text.includes(
			'Lina, Jonas und Mira und 2 weitere sind schon dabei.',
		),
	);
});

test('German stays the default and an explicit de renders the same mail', () => {
	assert.deepEqual(renderWelcomeMail({ firstName: 'Lina', locale: 'de' }), ALL[0]);
	assert.deepEqual(renderAccountDeletedMail('de'), ALL[3]);
});

const SUPABASE_DIR = new URL('../../../../../supabase/templates/', import.meta.url);
const { selectLocale } = (await import(new URL('render.mjs', SUPABASE_DIR).href)) as {
	selectLocale: (text: string, locale: 'de' | 'en') => string;
};

test('the Supabase auth templates render in both locales and balance every block', () => {
	const subjects = JSON.parse(
		readFileSync(new URL('subjects.json', SUPABASE_DIR), 'utf8'),
	) as Record<string, string>;
	const files = [
		...readdirSync(SUPABASE_DIR)
			.filter((file) => file.endsWith('.html'))
			.map((file) => ({ name: file, text: readFileSync(new URL(file, SUPABASE_DIR), 'utf8') })),
		...Object.entries(subjects).map(([name, text]) => ({ name, text })),
	];
	for (const { name, text } of files) {
		const opens = text.match(/\{\{\s*if\b/g)?.length ?? 0;
		assert.equal(text.match(/\{\{\s*end\s*\}\}/g)?.length ?? 0, opens, name);
		assert.equal(text.match(/\{\{\s*else\s*\}\}/g)?.length ?? 0, opens, name);
		const de = selectLocale(text, 'de');
		const en = selectLocale(text, 'en');
		assert.ok(!/\{\{\s*(if|else|end)\b/.test(de + en), name);
		assert.notEqual(de, en, name);
		if (name.endsWith('.html')) {
			assert.ok(de.includes('<html lang="de"'), name);
			assert.ok(en.includes('<html lang="en-GB"'), name);
			assert.ok(!/Impressum|Datenschutz/.test(en), name);
		}
	}
});

test('compose.yaml carries the same auth mail subjects as subjects.json', () => {
	const subjects = JSON.parse(
		readFileSync(new URL('subjects.json', SUPABASE_DIR), 'utf8'),
	) as Record<string, string>;
	const compose = readFileSync(new URL('../../../../../compose.yaml', import.meta.url), 'utf8');
	const fromCompose = Object.fromEntries(
		[...compose.matchAll(/GOTRUE_MAILER_SUBJECTS_(\w+): '(.*)'/g)].map(([, name, value]) => [
			(name ?? '').toLowerCase().replace('_notification', ''),
			value,
		]),
	);
	assert.deepEqual(fromCompose, subjects);
});
