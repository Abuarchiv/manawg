/**
 * The e-mail shell from the Touchpoints design: 600 px wide, mark and wordmark
 * in the head, eyebrow in mono, title in Inter Tight, 15 px body, one black
 * button, footer on #FAFAFA that names the reason for the mail. Colour is used
 * only for owed and settled amounts. Every mail is rendered as HTML and text, in light and dark.
 */

import { getAppUrl } from '@/shared/lib/app-url';
import { legalUrl } from '@/shared/lib/landing-url';
import { MAIL_COLOR_SCHEME_META, MAIL_DARK_STYLE, markImages } from './dark-mode';

export const APP_ORIGIN = getAppUrl();

const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const HEADLINE = `'Inter Tight', ${SANS}`;
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
const INK = '#0A0A0A';
const BODY = '#404040';
const MUTED = '#737373';
const LINE = '#E5E5E5';
const OWES_COLOR = '#E7000B';
const SETTLED_COLOR = '#14874E';

type Tone = 'owes' | 'settled';

export type MailBlock =
	| { kind: 'paragraph'; text: string }
	| { kind: 'steps'; items: string[] }
	| {
			kind: 'rows';
			rows: Array<{ label: string; detail?: string; value?: string; tone?: Tone }>;
	  }
	| { kind: 'code'; label: string; value: string }
	| { kind: 'people'; names: string[]; caption: string }
	| { kind: 'amount'; label: string; value: string; tone: Tone }
	| { kind: 'tiles'; tiles: Array<{ label: string; value: string }> };

export interface BrandMailSpec {
	subject: string;
	preheader: string;
	/** Mono eyebrow above the title, e.g. the WG name or "Einladung". */
	eyebrow: string;
	/** Right-aligned mono label in the head, e.g. a date; omitted when empty. */
	headLabel?: string;
	title: string;
	blocks: MailBlock[];
	button?: { label: string; url: string };
	/** Link fallback shown under the button in mono. */
	linkFallback?: string;
	/** Why the recipient gets this mail; always present in the footer. */
	footerNote: string;
	footerLinks?: Array<{ label: string; url: string }>;
}

export interface RenderedMail {
	subject: string;
	preheader: string;
	html: string;
	text: string;
}

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function toneColor(tone: Tone | undefined): string {
	if (tone === 'owes') return OWES_COLOR;
	if (tone === 'settled') return SETTLED_COLOR;
	return INK;
}

function initials(name: string): string {
	return name.trim().charAt(0).toUpperCase() || '?';
}

function renderBlock(block: MailBlock): string {
	switch (block.kind) {
		case 'paragraph':
			return `<tr><td style="padding:0 0 18px 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${BODY};">${escapeHtml(block.text)}</td></tr>`;
		case 'steps':
			return `<tr><td style="padding:0 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${block.items
				.map(
					(item, index) =>
						`<tr><td valign="top" width="36" style="padding:10px 0;border-top:1px solid ${LINE};font-family:${MONO};font-size:12px;line-height:1.6;color:${MUTED};">${String(index + 1).padStart(2, '0')}</td><td valign="top" style="padding:10px 0;border-top:1px solid ${LINE};font-family:${SANS};font-size:15px;line-height:1.6;color:${INK};">${escapeHtml(item)}</td></tr>`,
				)
				.join('')}</table></td></tr>`;
		case 'rows':
			return `<tr><td style="padding:0 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${block.rows
				.map((row) => {
					const detail = row.detail
						? `<span style="display:block;font-size:13px;line-height:1.5;color:${MUTED};">${escapeHtml(row.detail)}</span>`
						: '';
					const value =
						row.value === undefined
							? ''
							: `<td align="right" valign="top" style="padding:10px 0 10px 16px;border-top:1px solid ${LINE};font-family:${MONO};font-size:14px;line-height:1.5;color:${toneColor(row.tone)};white-space:nowrap;">${escapeHtml(row.value)}</td>`;
					return `<tr><td valign="top" style="padding:10px 0;border-top:1px solid ${LINE};font-family:${SANS};font-size:15px;line-height:1.5;color:${INK};">${escapeHtml(row.label)}${detail}</td>${value}</tr>`;
				})
				.join('')}</table></td></tr>`;
		case 'code':
			return `<tr><td style="padding:0 0 24px 0;"><div style="font-family:${SANS};font-size:13px;line-height:1.4;color:${MUTED};padding-bottom:8px;">${escapeHtml(block.label)}</div><div style="font-family:${MONO};font-weight:500;font-size:28px;line-height:1.2;letter-spacing:0.08em;color:${INK};">${escapeHtml(block.value)}</div></td></tr>`;
		case 'people': {
			const circles = block.names
				.slice(0, 5)
				.map(
					(name) =>
						`<td width="36" style="padding:0 8px 0 0;"><div style="width:36px;height:36px;line-height:36px;border-radius:18px;background-color:#F5F5F5;border:1px solid ${LINE};text-align:center;font-family:${HEADLINE};font-weight:600;font-size:14px;color:${INK};">${escapeHtml(initials(name))}</div></td>`,
				)
				.join('');
			return `<tr><td style="padding:0 0 24px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${circles}</tr></table><div style="padding-top:10px;font-family:${SANS};font-size:14px;line-height:1.5;color:${BODY};">${escapeHtml(block.caption)}</div></td></tr>`;
		}
		case 'amount': {
			const color = toneColor(block.tone);
			return `<tr><td style="padding:0 0 20px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="font-family:${SANS};font-weight:500;font-size:15px;line-height:1.4;color:${color};"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background-color:${color};margin-right:10px;vertical-align:middle;"></span>${escapeHtml(block.label)}</td><td align="right" valign="middle" style="font-family:${MONO};font-size:22px;line-height:1.2;color:${color};white-space:nowrap;">${escapeHtml(block.value)}</td></tr></table></td></tr>`;
		}
		case 'tiles': {
			const width = `${(100 / Math.max(block.tiles.length, 1)).toFixed(2)}%`;
			return `<tr><td style="padding:0 0 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:14px;border-collapse:separate;"><tr>${block.tiles
				.map(
					(tile, index) =>
						`<td valign="top" style="width:${width};padding:16px 20px 18px 20px;${index > 0 ? `border-left:1px solid ${LINE};` : ''}"><div style="font-family:${SANS};font-size:12px;line-height:1.3;color:${MUTED};padding-bottom:8px;">${escapeHtml(tile.label)}</div><div style="font-family:${MONO};font-weight:500;font-size:18px;line-height:1.2;color:${INK};white-space:nowrap;">${escapeHtml(tile.value)}</div></td>`,
				)
				.join('')}</tr></table></td></tr>`;
		}
	}
}

function blockText(block: MailBlock): string[] {
	switch (block.kind) {
		case 'paragraph':
			return [block.text, ''];
		case 'steps':
			return [...block.items.map((item, index) => `${index + 1}. ${item}`), ''];
		case 'rows':
			return [
				...block.rows.map((row) =>
					[row.label, row.detail ? `(${row.detail})` : '', row.value ?? '']
						.filter(Boolean)
						.join(' '),
				),
				'',
			];
		case 'code':
			return [`${block.label}: ${block.value}`, ''];
		case 'people':
			return [block.caption, ''];
		case 'amount':
			return [`${block.label}: ${block.value}`, ''];
		case 'tiles':
			return [...block.tiles.map((tile) => `${tile.label}: ${tile.value}`), ''];
	}
}

function head(label: string | undefined): string {
	const mark = markImages();
	const right = label
		? `<td align="right" valign="middle" style="font-family:${MONO};font-size:11px;line-height:1;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};white-space:nowrap;">${escapeHtml(label)}</td>`
		: '';
	return `<tr><td style="padding:22px 40px;border-bottom:1px solid ${LINE};"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="1" style="padding-right:10px;">${mark}</td><td valign="middle" style="font-family:${HEADLINE};font-weight:600;font-size:15px;line-height:1;letter-spacing:-0.02em;color:${INK};">ManaWG</td>${right}</tr></table></td></tr>`;
}

function footer(spec: BrandMailSpec): string {
	const link = `style="color:${MUTED};text-decoration:underline;"`;
	const links = [
		...(spec.footerLinks ?? []),
		{ label: 'Impressum', url: legalUrl('/impressum') },
		{ label: 'Datenschutz', url: legalUrl('/datenschutz') },
	]
		.map((entry) => `<a href="${escapeHtml(entry.url)}" ${link}>${escapeHtml(entry.label)}</a>`)
		.join(' &middot; ');
	return `<tr><td bgcolor="#FAFAFA" style="background-color:#FAFAFA;border-top:1px solid ${LINE};padding:22px 40px;"><div style="font-family:${SANS};font-size:12px;line-height:1.55;color:${MUTED};">${escapeHtml(spec.footerNote)}</div><div style="padding-top:6px;font-family:${MONO};font-size:11px;line-height:1.55;letter-spacing:0.06em;color:${MUTED};">${escapeHtml(APP_ORIGIN.replace(/^https?:\/\//, ''))} &middot; ${links}</div></td></tr>`;
}

function button(spec: BrandMailSpec): string {
	if (!spec.button) return '';
	const fallback = spec.linkFallback
		? `<tr><td style="padding:14px 0 0 0;font-family:${MONO};font-size:11px;line-height:1.6;color:${MUTED};word-break:break-all;">Falls der Button nicht geht: ${escapeHtml(spec.linkFallback)}</td></tr>`
		: '';
	return `<tr><td style="padding:4px 0 0 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#171717" style="background-color:#171717;border-radius:10px;"><a href="${escapeHtml(spec.button.url)}" style="display:inline-block;padding:13px 20px;font-family:${SANS};font-size:15px;line-height:1.3;font-weight:500;color:#FAFAFA;text-decoration:none;border-radius:10px;">${escapeHtml(spec.button.label)}</a></td></tr></table></td></tr>${fallback}`;
}

export function renderBrandMail(spec: BrandMailSpec): RenderedMail {
	const eyebrow = `<tr><td style="padding:0 0 14px 0;font-family:${MONO};font-size:11px;line-height:1.4;letter-spacing:0.14em;text-transform:uppercase;color:${MUTED};">${escapeHtml(spec.eyebrow)}</td></tr>`;
	const title = `<tr><td style="padding:0 0 24px 0;font-family:${HEADLINE};font-weight:600;font-size:28px;line-height:1.15;letter-spacing:-0.03em;color:${INK};">${escapeHtml(spec.title)}</td></tr>`;
	const html = `<!DOCTYPE html>
<html lang="de" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${MAIL_COLOR_SCHEME_META}
<title>${escapeHtml(spec.subject)}</title>
${MAIL_DARK_STYLE}
</head>
<body style="margin:0;padding:0;background-color:#F5F5F5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(spec.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F5F5" style="background-color:#F5F5F5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid ${LINE};">
${head(spec.headLabel)}
<tr><td style="padding:40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${eyebrow}
${title}
${spec.blocks.map(renderBlock).join('\n')}
${button(spec)}
</table></td></tr>
${footer(spec)}
</table>
</td></tr>
</table>
</body>
</html>
`;
	const text = [
		`ManaWG · ${spec.eyebrow}`,
		'',
		spec.title,
		'',
		...spec.blocks.flatMap(blockText),
		...(spec.button ? [`${spec.button.label}: ${spec.button.url}`, ''] : []),
		spec.footerNote,
		...(spec.footerLinks ?? []).map((entry) => `${entry.label}: ${entry.url}`),
	].join('\n');
	return { subject: spec.subject, preheader: spec.preheader, html, text };
}
