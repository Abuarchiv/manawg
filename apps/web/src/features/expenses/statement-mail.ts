import { serverT } from '@/core/i18n/server-t';
import { APP_ORIGIN, escapeHtml } from '@/core/mail/brand-mail';
import { formatEuroCents, normalizeCurrency } from '@/core/utils/money';
import { formatDayMonthYear } from '@/core/utils/time';
import { dateTimeFormat } from '@/shared/i18n/intl';
import { DEFAULT_LOCALE, htmlLang, type Locale } from '@/shared/i18n/locale';
import type { MonthlyStatement } from './monthly-statement';

type MailT = ReturnType<typeof serverT<'mail'>>;

export interface StatementMailInput {
	wgName: string;
	shareCode: string;
	statement: MonthlyStatement;
	memberId: string;
	unsubscribeUrl: string;
	/** The recipient's language; German when absent. */
	locale?: Locale | undefined;
	/** The statement travels as a PDF attachment; true when absent. */
	withPdf?: boolean;
}

export interface StatementMail {
	subject: string;
	preheader: string;
	html: string;
	text: string;
}

type StatusKind = 'settled' | 'owed' | 'owes';

/** One currency the recipient has an open balance in, with the transfers that involve them. */
interface BalanceBlock {
	kind: 'owed' | 'owes';
	currency: string;
	cents: number;
	/** Who they pay or who pays them. */
	transfers: Array<{ name: string; cents: number }>;
}

interface StatementView {
	monthName: string;
	monthLabel: string;
	participants: number;
	expenseCount: number;
	shareCents: number;
	asOf: string;
	/** Empty when the recipient has nothing open in any currency. */
	balances: BalanceBlock[];
}

const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const HEADLINE = `'Inter Tight', ${SANS}`;
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const INK = '#0A0A0A';
const MUTED = '#737373';
const LINE = '#E5E5E5';
const BODY = '#404040';
const SURFACE = '#FAFAFA';
const PAGE_BG = '#F5F5F5';
const CARD_BG = '#FFFFFF';
const BUTTON_BG = '#171717';
// The two semantic colors of the design: debt (`destructive`) and `settled`.
const OWES_COLOR = '#E7000B';
const SETTLED_COLOR = '#14874E';

function segmentLabel(t: MailT, kind: StatusKind): string {
	if (kind === 'settled') return t('statement.segmentSettled');
	return kind === 'owed' ? t('statement.segmentOwed') : t('statement.segmentOwes');
}

function monthParts(monthKey: string, locale: Locale): { monthName: string; year: string } {
	const [year = '', month = '1'] = monthKey.split('-');
	const monthName = dateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
		new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
	);
	return { monthName, year };
}

function buildView(input: StatementMailInput, locale: Locale): StatementView {
	const { statement, memberId } = input;
	const { monthName, year } = monthParts(statement.monthKey, locale);
	const row = statement.members.find((member) => member.id === memberId);
	const balances = statement.open
		.filter((open) => open.memberId === memberId)
		.map((open): BalanceBlock => {
			const kind = open.cents > 0 ? 'owed' : 'owes';
			const transfers: BalanceBlock['transfers'] = [];
			for (const transfer of statement.transfers) {
				if (normalizeCurrency(transfer.currency ?? 'EUR') !== open.currency) continue;
				if (kind === 'owes' && transfer.fromId === memberId) {
					transfers.push({ name: transfer.toName, cents: transfer.cents });
				}
				if (kind === 'owed' && transfer.toId === memberId) {
					transfers.push({ name: transfer.fromName, cents: transfer.cents });
				}
			}
			return { kind, currency: open.currency, cents: Math.abs(open.cents), transfers };
		});
	return {
		monthName,
		monthLabel: `${monthName} ${year}`,
		participants: statement.members.filter((m) => m.paidCents > 0 || m.shareCents > 0).length,
		expenseCount: statement.items.length,
		shareCents: row?.shareCents ?? 0,
		asOf: formatDayMonthYear(statement.asOf, locale),
		balances,
	};
}

/** The rows of the status block: one per open currency, or a single settled row. */
function statusEntries(
	view: StatementView,
	locale: Locale,
): Array<{
	kind: StatusKind;
	amount: string;
	transfers: BalanceBlock['transfers'];
	currency: string;
}> {
	if (view.balances.length === 0) {
		return [
			{
				kind: 'settled',
				amount: formatEuroCents(0, 'EUR', { locale }),
				transfers: [],
				currency: 'EUR',
			},
		];
	}
	return view.balances.map((balance) => ({
		kind: balance.kind,
		amount: formatEuroCents(balance.cents, balance.currency, {
			signed: balance.kind === 'owed',
			locale,
		}),
		transfers: balance.transfers,
		currency: balance.currency,
	}));
}

function preheader(view: StatementView, t: MailT, locale: Locale): string {
	const [only] = view.balances;
	const status = view.balances.length > 1 ? 'multiple' : (only?.kind ?? 'settled');
	return t('statement.preheader', {
		people: view.participants,
		expenses: view.expenseCount,
		status: status === 'owes' ? 'other' : status,
		amount: only ? formatEuroCents(only.cents, only.currency, { locale }) : '',
	});
}

function transferLines(
	entry: ReturnType<typeof statusEntries>[number],
	t: MailT,
	locale: Locale,
): Array<{ label: string; amount: string }> {
	return entry.transfers.map((transfer) => ({
		label: t(entry.kind === 'owed' ? 'statement.transferFrom' : 'statement.transferTo', {
			name: transfer.name,
		}),
		amount: formatEuroCents(transfer.cents, entry.currency, { locale }),
	}));
}

function plainText(
	input: StatementMailInput,
	view: StatementView,
	links: Links,
	t: MailT,
	locale: Locale,
): string {
	const money = (cents: number) => formatEuroCents(cents, 'EUR', { locale });
	const lines = [
		`${input.wgName} · ${view.monthLabel}`,
		'',
		t('statement.title', { month: view.monthName }),
		'',
		`${t('statement.total')}: ${money(input.statement.totalCents)}`,
		`${t('statement.expenses')}: ${view.expenseCount}`,
		`${t('statement.share')}: ${money(view.shareCents)}`,
		'',
		t('statement.openAsOf', { date: view.asOf }),
		...statusEntries(view, locale).flatMap((entry) => [
			`${segmentLabel(t, entry.kind)}: ${entry.amount}`,
			...transferLines(entry, t, locale).map((line) => `  ${line.label} ${line.amount}`),
		]),
		'',
		...(input.withPdf === false ? [] : [t('statement.attached')]),
		`${t('statement.viewStatement')}: ${links.statement}`,
		'',
		t('statement.cadence'),
		`${t('shell.changeSettings')}: ${links.settings}`,
		`${t('shell.unsubscribe')}: ${links.unsubscribe}`,
	];
	return lines.join('\n');
}

interface Links {
	statement: string;
	settings: string;
	unsubscribe: string;
}

function cell(style: string, content: string, attrs = ''): string {
	return `<td${attrs} style="${style}">${content}</td>`;
}

function tile(label: string, value: string, divider: boolean): string {
	const border = divider ? `border-left:1px solid ${LINE};` : '';
	return cell(
		`width:33.33%;padding:16px 20px 18px 20px;${border}`,
		`<div style="font-family:${SANS};font-size:12px;line-height:1.3;color:${MUTED};padding-bottom:8px;">${label}</div>` +
			`<div style="font-family:${MONO};font-weight:500;font-size:18px;line-height:1.2;color:${INK};white-space:nowrap;">${value}</div>`,
		' valign="top"',
	);
}

function statusRow(view: StatementView, t: MailT, locale: Locale): string {
	const asOf = `<tr><td style="padding:0 0 10px 0;font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${escapeHtml(t('statement.openAsOf', { date: view.asOf }))}</td></tr>`;
	const rows = statusEntries(view, locale).map((entry) => {
		const color = entry.kind === 'owes' ? OWES_COLOR : SETTLED_COLOR;
		const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:${color};margin-right:10px;vertical-align:middle;"></span>`;
		const amountColor = entry.kind === 'settled' ? MUTED : color;
		const transfers = transferLines(entry, t, locale)
			.map(
				(line) =>
					`<tr><td style="padding:6px 0 0 17px;font-family:${SANS};font-size:14px;line-height:1.5;color:${BODY};">${escapeHtml(line.label)}</td>` +
					`<td align="right" style="padding:6px 0 0 0;font-family:${MONO};font-size:13px;line-height:1.5;color:${BODY};white-space:nowrap;">${line.amount}</td></tr>`,
			)
			.join('');
		return `<tr><td valign="middle" style="padding-top:8px;font-family:${SANS};font-weight:500;font-size:15px;line-height:1.4;color:${color};">${dot}${escapeHtml(segmentLabel(t, entry.kind))}</td><td align="right" valign="middle" style="padding-top:8px;font-family:${MONO};font-size:14px;line-height:1.4;color:${amountColor};white-space:nowrap;">${entry.amount}</td></tr>${transfers}`;
	});
	return `<tr><td style="padding:0 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${asOf}<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table></td></tr></table></td></tr>`;
}

function header(monthLabel: string): string {
	const mark = `<img src="${APP_ORIGIN}/email/manawg-mark-96.png" width="24" height="20" alt="" style="display:block;width:24px;height:20px;border:0;">`;
	return `<tr><td style="padding:22px 40px;border-bottom:1px solid ${LINE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="1" style="padding-right:10px;">${mark}</td><td valign="middle" style="font-family:${HEADLINE};font-weight:600;font-size:15px;line-height:1;letter-spacing:-0.02em;color:${INK};">ManaWG</td><td align="right" valign="middle" style="font-family:${MONO};font-size:11px;line-height:1;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};white-space:nowrap;">${escapeHtml(monthLabel)}</td></tr></table></td></tr>`;
}

function footer(links: Links, t: MailT): string {
	const link = `style="color:${MUTED};text-decoration:underline;"`;
	return `<tr><td bgcolor="${SURFACE}" style="background-color:${SURFACE};border-top:1px solid ${LINE};padding:22px 40px;"><div style="font-family:${SANS};font-size:12px;line-height:1.55;color:${MUTED};">${escapeHtml(t('statement.cadence'))}</div><div style="padding-top:6px;font-family:${MONO};font-size:11px;line-height:1.55;letter-spacing:0.06em;color:${MUTED};"><a href="${escapeHtml(links.settings)}" ${link}>${escapeHtml(t('shell.changeSettings'))}</a> &middot; <a href="${escapeHtml(links.unsubscribe)}" ${link}>${escapeHtml(t('shell.unsubscribe'))}</a></div></td></tr>`;
}

function htmlDocument(
	input: StatementMailInput,
	view: StatementView,
	links: Links,
	t: MailT,
	locale: Locale,
): string {
	const money = (cents: number) => formatEuroCents(cents, 'EUR', { locale });
	const attached =
		input.withPdf === false
			? ''
			: `<tr><td style="padding:0 0 16px 0;font-family:${SANS};font-size:14px;line-height:1.5;color:${BODY};">${escapeHtml(t('statement.attached'))}</td></tr>`;
	const button = `<tr><td style="padding:0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${BUTTON_BG}" style="background-color:${BUTTON_BG};border-radius:10px;"><a href="${escapeHtml(links.statement)}" style="display:inline-block;padding:13px 20px;font-family:${SANS};font-size:15px;line-height:1.3;font-weight:500;color:${SURFACE};text-decoration:none;border-radius:10px;">${escapeHtml(t('statement.viewStatement'))}</a></td></tr></table></td></tr>`;
	const tiles = `<tr><td style="padding:0 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:14px;border-collapse:separate;"><tr>${tile(escapeHtml(t('statement.total')), money(input.statement.totalCents), false)}${tile(escapeHtml(t('statement.expenses')), String(view.expenseCount), true)}${tile(escapeHtml(t('statement.share')), money(view.shareCents), true)}</tr></table></td></tr>`;
	const eyebrow = `<tr><td style="padding:0 0 14px 0;font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${escapeHtml(input.wgName)}</td></tr>`;
	const title = `<tr><td style="padding:0 0 28px 0;font-family:${HEADLINE};font-weight:600;font-size:34px;line-height:1.1;letter-spacing:-0.03em;color:${INK};">${escapeHtml(t('statement.title', { month: view.monthName }))}</td></tr>`;
	return `<!DOCTYPE html>
<html lang="${htmlLang(locale)}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(t('statement.subject', { month: view.monthName }))}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader(view, t, locale))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BG}" style="background-color:${PAGE_BG};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD_BG}" style="width:100%;max-width:600px;background-color:${CARD_BG};border:1px solid ${LINE};">
${header(view.monthLabel)}
<tr><td style="padding:40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${eyebrow}
${title}
${tiles}
${statusRow(view, t, locale)}
${attached}
${button}
</table></td></tr>
${footer(links, t)}
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/** Renders one member's statement mail: subject, inbox preview, HTML and plain text. */
export function renderStatementMail(input: StatementMailInput): StatementMail {
	const locale = input.locale ?? DEFAULT_LOCALE;
	const t = serverT(locale, 'mail');
	const view = buildView(input, locale);
	const wgBase = `${APP_ORIGIN}/wg/${encodeURIComponent(input.shareCode)}`;
	const links: Links = {
		statement: `${wgBase}/statement?month=${input.statement.monthKey}`,
		settings: `${wgBase}/settings`,
		unsubscribe: input.unsubscribeUrl,
	};
	return {
		subject: t('statement.subject', { month: view.monthName }),
		preheader: preheader(view, t, locale),
		html: htmlDocument(input, view, links, t, locale),
		text: plainText(input, view, links, t, locale),
	};
}
