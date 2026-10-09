import { formatEuroCents } from '@/core/utils/money';
import type { MonthlyStatement } from './monthly-statement';

export const APP_ORIGIN = 'https://app.manawg.com';

export interface StatementMailInput {
	wgName: string;
	shareCode: string;
	statement: MonthlyStatement;
	memberId: string;
	unsubscribeUrl: string;
}

export interface StatementMail {
	subject: string;
	preheader: string;
	html: string;
	text: string;
}

type StatusKind = 'settled' | 'owed' | 'owes';

interface StatementView {
	monthName: string;
	monthLabel: string;
	participants: number;
	expenseCount: number;
	shareCents: number;
	kind: StatusKind;
	statusCents: number;
	/** Transfers that involve the member: who they pay or who pays them. */
	transfers: Array<{ name: string; cents: number }>;
}

const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const HEADLINE = `'Inter Tight', ${SANS}`;
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const INK = '#0A0A0A';
const MUTED = '#737373';
const LINE = '#E5E5E5';
// The two semantic colors of the design: debt (`destructive`) and `settled`.
const OWES_COLOR = '#E7000B';
const SETTLED_COLOR = '#14874E';

const SEGMENT_LABELS: Record<StatusKind, string> = {
	settled: 'Alles ausgeglichen',
	owed: 'Du bekommst',
	owes: 'Du schuldest',
};

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function monthParts(monthKey: string): { monthName: string; year: string } {
	const [year = '', month = '1'] = monthKey.split('-');
	const monthName = new Intl.DateTimeFormat('de-DE', { month: 'long', timeZone: 'UTC' }).format(
		new Date(Date.UTC(Number(year), Number(month) - 1, 1)),
	);
	return { monthName, year };
}

function buildView(input: StatementMailInput): StatementView {
	const { statement, memberId } = input;
	const { monthName, year } = monthParts(statement.monthKey);
	const row = statement.members.find((member) => member.id === memberId);
	const balance = row?.balanceCents ?? 0;
	const kind: StatusKind =
		statement.settled || balance === 0 ? 'settled' : balance > 0 ? 'owed' : 'owes';
	const transfers: StatementView['transfers'] = [];
	for (const transfer of statement.transfers) {
		if (kind === 'owes' && transfer.fromId === memberId) {
			transfers.push({ name: transfer.toName, cents: transfer.cents });
		}
		if (kind === 'owed' && transfer.toId === memberId) {
			transfers.push({ name: transfer.fromName, cents: transfer.cents });
		}
	}
	return {
		monthName,
		monthLabel: `${monthName} ${year}`,
		participants: statement.members.filter((m) => m.paidCents > 0 || m.shareCents > 0).length,
		expenseCount: statement.items.length,
		shareCents: row?.shareCents ?? 0,
		kind,
		statusCents: kind === 'settled' ? 0 : Math.abs(balance),
		transfers,
	};
}

function statusAmount(view: StatementView): string {
	if (view.kind === 'owed') return formatEuroCents(view.statusCents, 'EUR', { signed: true });
	return formatEuroCents(view.statusCents);
}

function preheader(view: StatementView): string {
	const people = `${view.participants} Personen`;
	const expenses = view.expenseCount === 1 ? '1 Ausgabe' : `${view.expenseCount} Ausgaben`;
	const status =
		view.kind === 'settled'
			? 'alles ausgeglichen'
			: `${view.kind === 'owed' ? 'du bekommst' : 'du schuldest'} ${formatEuroCents(view.statusCents)}`;
	return `${people}, ${expenses}, ${status}.`;
}

function transferLines(view: StatementView): Array<{ label: string; amount: string }> {
	const preposition = view.kind === 'owed' ? 'von' : 'an';
	return view.transfers.map((transfer) => ({
		label: `${preposition} ${transfer.name}`,
		amount: formatEuroCents(transfer.cents),
	}));
}

function plainText(input: StatementMailInput, view: StatementView, links: Links): string {
	const lines = [
		`${input.wgName} · ${view.monthLabel}`,
		'',
		`${view.monthName} ist abgerechnet.`,
		'',
		`Gesamt: ${formatEuroCents(input.statement.totalCents)}`,
		`Ausgaben: ${view.expenseCount}`,
		`Dein Anteil: ${formatEuroCents(view.shareCents)}`,
		'',
		`${SEGMENT_LABELS[view.kind]}: ${statusAmount(view)}`,
		...transferLines(view).map((line) => `  ${line.label} ${line.amount}`),
		'',
		`Abrechnung ansehen: ${links.statement}`,
		'',
		'Einmal im Monat, am Ersten. Als PDF in der App.',
		`Einstellungen ändern: ${links.settings}`,
		`Abbestellen: ${links.unsubscribe}`,
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

function statusRow(view: StatementView): string {
	const color = view.kind === 'owes' ? OWES_COLOR : SETTLED_COLOR;
	const dot = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:${color};margin-right:10px;vertical-align:middle;"></span>`;
	const amountColor = view.kind === 'settled' ? MUTED : color;
	const transfers = transferLines(view)
		.map(
			(line) =>
				`<tr><td style="padding:6px 0 0 17px;font-family:${SANS};font-size:14px;line-height:1.5;color:#404040;">${escapeHtml(line.label)}</td>` +
				`<td align="right" style="padding:6px 0 0 0;font-family:${MONO};font-size:13px;line-height:1.5;color:#404040;white-space:nowrap;">${line.amount}</td></tr>`,
		)
		.join('');
	return `<tr><td style="padding:0 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="font-family:${SANS};font-weight:500;font-size:15px;line-height:1.4;color:${color};">${dot}${SEGMENT_LABELS[view.kind]}</td><td align="right" valign="middle" style="font-family:${MONO};font-size:14px;line-height:1.4;color:${amountColor};white-space:nowrap;">${statusAmount(view)}</td></tr>${transfers}</table></td></tr>`;
}

function header(monthLabel: string): string {
	const mark = `<img src="${APP_ORIGIN}/email/manawg-mark-96.png" width="24" height="20" alt="" style="display:block;width:24px;height:20px;border:0;">`;
	return `<tr><td style="padding:22px 40px;border-bottom:1px solid ${LINE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="1" style="padding-right:10px;">${mark}</td><td valign="middle" style="font-family:${HEADLINE};font-weight:600;font-size:15px;line-height:1;letter-spacing:-0.02em;color:${INK};">ManaWG</td><td align="right" valign="middle" style="font-family:${MONO};font-size:11px;line-height:1;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};white-space:nowrap;">${escapeHtml(monthLabel)}</td></tr></table></td></tr>`;
}

function footer(links: Links): string {
	const link = `style="color:${MUTED};text-decoration:underline;"`;
	return `<tr><td bgcolor="#FAFAFA" style="background-color:#FAFAFA;border-top:1px solid ${LINE};padding:22px 40px;"><div style="font-family:${SANS};font-size:12px;line-height:1.55;color:${MUTED};">Einmal im Monat, am Ersten. Als PDF in der App.</div><div style="padding-top:6px;font-family:${MONO};font-size:11px;line-height:1.55;letter-spacing:0.06em;color:${MUTED};"><a href="${escapeHtml(links.settings)}" ${link}>Einstellungen ändern</a> &middot; <a href="${escapeHtml(links.unsubscribe)}" ${link}>Abbestellen</a></div></td></tr>`;
}

function htmlDocument(input: StatementMailInput, view: StatementView, links: Links): string {
	const button = `<tr><td style="padding:0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#171717" style="background-color:#171717;border-radius:10px;"><a href="${escapeHtml(links.statement)}" style="display:inline-block;padding:13px 20px;font-family:${SANS};font-size:15px;line-height:1.3;font-weight:500;color:#FAFAFA;text-decoration:none;border-radius:10px;">Abrechnung ansehen</a></td></tr></table></td></tr>`;
	const tiles = `<tr><td style="padding:0 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:14px;border-collapse:separate;"><tr>${tile('Gesamt', formatEuroCents(input.statement.totalCents), false)}${tile('Ausgaben', String(view.expenseCount), true)}${tile('Dein Anteil', formatEuroCents(view.shareCents), true)}</tr></table></td></tr>`;
	const eyebrow = `<tr><td style="padding:0 0 14px 0;font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${escapeHtml(input.wgName)}</td></tr>`;
	const title = `<tr><td style="padding:0 0 28px 0;font-family:${HEADLINE};font-weight:600;font-size:34px;line-height:1.1;letter-spacing:-0.03em;color:${INK};">${escapeHtml(view.monthName)} ist abgerechnet.</td></tr>`;
	return `<!DOCTYPE html>
<html lang="de" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(view.monthName)} ist abgerechnet</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F5F5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader(view))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F5F5" style="background-color:#F5F5F5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid ${LINE};">
${header(view.monthLabel)}
<tr><td style="padding:40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${eyebrow}
${title}
${tiles}
${statusRow(view)}
${button}
</table></td></tr>
${footer(links)}
</table>
</td></tr>
</table>
</body>
</html>
`;
}

/** Renders one member's statement mail: subject, inbox preview, HTML and plain text. */
export function renderStatementMail(input: StatementMailInput): StatementMail {
	const view = buildView(input);
	const wgBase = `${APP_ORIGIN}/wg/${encodeURIComponent(input.shareCode)}`;
	const links: Links = {
		statement: `${wgBase}/abrechnung?monat=${input.statement.monthKey}`,
		settings: `${wgBase}/einstellungen`,
		unsubscribe: input.unsubscribeUrl,
	};
	return {
		subject: `${view.monthName} ist abgerechnet`,
		preheader: preheader(view),
		html: htmlDocument(input, view, links),
		text: plainText(input, view, links),
	};
}
