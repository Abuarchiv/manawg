import { formatEuroCents } from '@/core/utils/money';
import { APP_ORIGIN, type MailBlock, type RenderedMail, renderBrandMail } from './brand-mail';

/*
 * The transactional mails of the Touchpoints design (E1, E6, E7, E8, E10):
 * one thought per mail, amounts in mono, no exclamation marks, nothing that is
 * not actionable. E2–E5 are Supabase Auth templates, E9 is the statement mail.
 */

const WG_PATH = (shareCode: string) => `${APP_ORIGIN}/wg/${encodeURIComponent(shareCode)}`;

function joinNames(names: readonly string[]): string {
	if (names.length === 0) return '';
	if (names.length === 1) return names[0] ?? '';
	return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/** E1 · after the address is confirmed or the first social sign-in. */
export function renderWelcomeMail(input: { firstName: string | null }): RenderedMail {
	const greeting = input.firstName
		? `Hallo ${input.firstName}, dein Konto ist bereit.`
		: 'Dein Konto ist bereit.';
	return renderBrandMail({
		subject: 'Willkommen bei ManaWG',
		preheader: 'Drei Schritte, dann läuft eure WG.',
		eyebrow: 'ManaWG',
		title: 'Verschiedene Menschen teilen einen Alltag.',
		blocks: [
			{
				kind: 'paragraph',
				text: `${greeting} ManaWG hält Ausgaben, Putzplan, Einkauf und Termine für alle in der WG an einem Ort.`,
			},
			{
				kind: 'steps',
				items: [
					'WG anlegen oder mit Code beitreten',
					'Mitbewohner einladen',
					'Erste Ausgabe eintragen',
				],
			},
		],
		button: { label: 'WG einrichten', url: `${APP_ORIGIN}/neu` },
		footerNote: 'Du erhältst diese E-Mail, weil du ein Konto bei ManaWG erstellt hast.',
	});
}

/** E6 · a member types an address; the code is the same one the share card shows. */
export function renderInvitationMail(input: {
	inviterName: string;
	wgName: string;
	shareCode: string;
	memberNames: readonly string[];
}): RenderedMail {
	const others = input.memberNames.filter((name) => name !== input.inviterName);
	const names = [input.inviterName, ...others];
	const caption =
		names.length === 1
			? `${input.inviterName} ist schon dabei.`
			: `${joinNames(names.slice(0, 3))}${names.length > 3 ? ` und ${names.length - 3} weitere` : ''} sind schon dabei.`;
	const joinUrl = `${APP_ORIGIN}/?code=${encodeURIComponent(input.shareCode)}`;
	const count = names.length;
	return renderBrandMail({
		subject: `${input.inviterName} lädt dich in die WG ${input.wgName} ein`,
		preheader: count === 1 ? 'Eine Person ist schon dabei.' : `${count} Leute sind schon dabei.`,
		eyebrow: 'Einladung',
		title: `${input.inviterName} lädt dich in die WG ${input.wgName} ein.`,
		blocks: [
			{ kind: 'people', names, caption },
			{ kind: 'code', label: 'Oder in der App mit diesem Code beitreten', value: input.shareCode },
		],
		button: { label: 'Einladung annehmen', url: joinUrl },
		linkFallback: joinUrl,
		footerNote: `Der Code gilt, solange die WG Beitritte erlaubt. ${input.inviterName} hat deine Adresse eingegeben, wir speichern sie nicht weiter.`,
	});
}

export interface DigestItem {
	/** Mono label at the start of the row: Putzplan, Ausgabe, Termin, Vorrat. */
	label: string;
	text: string;
	/** Formatted amount or quantity shown right-aligned. */
	value?: string;
}

/** E7 · once a day for members without push, only when something happened. */
export function renderDigestMail(input: {
	wgName: string;
	shareCode: string;
	dayLabel: string;
	items: readonly DigestItem[];
	unsubscribeUrl: string;
}): RenderedMail {
	const summary = input.items
		.slice(0, 3)
		.map((item) => item.text.replace(/\.$/, ''))
		.join(', ');
	const rows: MailBlock = {
		kind: 'rows',
		rows: input.items.map((item) => ({
			label: item.text,
			detail: item.label,
			...(item.value === undefined ? {} : { value: item.value }),
		})),
	};
	return renderBrandMail({
		subject: `Heute in der ${input.wgName}`,
		preheader: `${summary}.`,
		eyebrow: input.wgName,
		headLabel: input.dayLabel,
		title: `Heute in der ${input.wgName}.`,
		blocks: [rows],
		button: { label: 'WG öffnen', url: WG_PATH(input.shareCode) },
		footerNote: 'Höchstens eine Zusammenfassung pro Tag. Kommt nur, wenn etwas passiert ist.',
		footerLinks: [
			{ label: 'Einstellungen ändern', url: `${WG_PATH(input.shareCode)}/einstellungen` },
			{ label: 'Abbestellen', url: input.unsubscribeUrl },
		],
	});
}

/** E8 · a creditor reminds a debtor who has no push; the debtor sees who and how much. */
export function renderReminderMail(input: {
	wgName: string;
	shareCode: string;
	creditorName: string;
	amountCents: number;
	oldestDebtAgeDays: number;
	items: ReadonlyArray<{ description: string; date: string; cents: number }>;
	unsubscribeUrl: string;
}): RenderedMail {
	const amount = formatEuroCents(input.amountCents);
	const age =
		input.oldestDebtAgeDays <= 0
			? 'Ältester Posten von heute.'
			: input.oldestDebtAgeDays === 1
				? 'Ältester Posten 1 Tag alt.'
				: `Ältester Posten ${input.oldestDebtAgeDays} Tage alt.`;
	const blocks: MailBlock[] = [
		{
			kind: 'amount',
			label: `Noch offen bei ${input.creditorName}`,
			value: `−${amount}`,
			tone: 'owes',
		},
	];
	if (input.items.length > 0) {
		blocks.push({
			kind: 'rows',
			rows: input.items.map((item) => ({
				label: item.description,
				detail: item.date,
				value: formatEuroCents(item.cents),
			})),
		});
	}
	blocks.push({
		kind: 'paragraph',
		text: `Ein Klick, und ihr seid quitt. ${input.creditorName} sieht es sofort in der App.`,
	});
	return renderBrandMail({
		subject: `Noch offen bei ${input.creditorName}: ${amount}`,
		preheader: age,
		eyebrow: 'Erinnerung',
		title: `Noch offen bei ${input.creditorName}.`,
		blocks,
		button: { label: 'Jetzt ausgleichen', url: `${WG_PATH(input.shareCode)}/ausgaben` },
		footerNote:
			'Erinnerungen kommen höchstens einmal pro Woche und nur, wenn du sie eingeschaltet hast.',
		footerLinks: [
			{ label: 'Einstellungen ändern', url: `${WG_PATH(input.shareCode)}/einstellungen` },
			{ label: 'Abbestellen', url: input.unsubscribeUrl },
		],
	});
}

/** E10 · the last mail an account receives. */
export function renderAccountDeletedMail(): RenderedMail {
	return renderBrandMail({
		subject: 'Dein Konto ist gelöscht',
		preheader: 'Dein Login ist entfernt.',
		eyebrow: 'ManaWG',
		title: 'Dein Konto ist gelöscht.',
		blocks: [
			{
				kind: 'paragraph',
				text: 'Dein Login sowie deine Push- und Kalender-Abos sind entfernt. Dein Name bleibt in den bisherigen Einträgen eurer WG stehen, damit die Beträge für die anderen stimmen.',
			},
			{
				kind: 'paragraph',
				text: 'Danke für die gemeinsame Zeit. Du kannst jederzeit ein neues Konto erstellen.',
			},
		],
		footerNote: 'Das ist die letzte E-Mail, die du von uns bekommst.',
	});
}
