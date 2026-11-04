import 'server-only';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import type { Locale } from '@/shared/i18n/locale';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
export const MARGIN = 48;
export const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const BOTTOM = MARGIN + 14;

export const INK = rgb(0.04, 0.04, 0.04);
export const MUTED = rgb(0.45, 0.45, 0.45);
export const RULE = rgb(0.88, 0.88, 0.88);
export const SETTLED = rgb(0.08, 0.53, 0.31);
export const OWES = rgb(0.91, 0, 0.04);

// Static Inter instances (the app's variable file embeds badly in PDF); the URL form lets the file tracer ship them.
const fontFiles = {
	regular: new URL('../../../shared/fonts/inter-pdf-regular.ttf', import.meta.url),
	bold: new URL('../../../shared/fonts/inter-pdf-semibold.ttf', import.meta.url),
};
let fontBytes: Promise<[Buffer, Buffer]> | undefined;
function loadFonts(): Promise<[Buffer, Buffer]> {
	fontBytes ??= Promise.all([readFile(fontFiles.regular), readFile(fontFiles.bold)]).catch(
		(error: unknown) => {
			fontBytes = undefined;
			throw error;
		},
	);
	return fontBytes;
}

/** Look-alikes for symbols the font lacks. */
const SUBSTITUTES: Readonly<Record<string, string>> = { '→': '>', '\u2212': '-' };

/**
 * Maps text to what the embedded font can draw: whitespace variants become a plain space,
 * a character the font lacks becomes a look-alike or its base letter (Ž to Z), otherwise `?`.
 */
function makeSafe(font: PDFFont): (text: string) => string {
	const known = new Set(font.getCharacterSet());
	return (text) =>
		Array.from(text.replace(/[\s  ]+/g, ' '), (char) => {
			if (known.has(char.codePointAt(0) ?? -1)) return char;
			const base = SUBSTITUTES[char] ?? char.normalize('NFD').charAt(0);
			return base && known.has(base.codePointAt(0) ?? -1) ? base : '?';
		}).join('');
}

export interface Sheet {
	doc: PDFDocument;
	font: PDFFont;
	bold: PDFFont;
	safe: (text: string) => string;
	page: PDFPage;
	y: number;
	locale: Locale;
	/** Width of one character at size 1; measuring whole strings is slow. */
	widths: Map<string, number>;
}

/** Text width as the sum of its characters; kerning is ignored. */
function width(sheet: Sheet, text: string, size: number): number {
	let sum = 0;
	for (const char of text) {
		let unit = sheet.widths.get(char);
		if (unit === undefined) {
			unit = sheet.font.widthOfTextAtSize(char, 1);
			sheet.widths.set(char, unit);
		}
		sum += unit;
	}
	return sum * size;
}

/** Starts a new page when fewer than `height` points are left; true when it did. */
export function ensure(sheet: Sheet, height: number): boolean {
	if (sheet.y - height >= BOTTOM) return false;
	sheet.page = sheet.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
	sheet.y = PAGE_HEIGHT - MARGIN;
	return true;
}

interface TextStyle {
	size?: number;
	color?: ReturnType<typeof rgb>;
	/** The text ends at `x` instead of starting there. */
	right?: boolean;
	bold?: boolean;
}

export function text(sheet: Sheet, value: string, x: number, style: TextStyle = {}): void {
	const size = style.size ?? 9.5;
	const safe = sheet.safe(value);
	const left = style.right ? x - width(sheet, safe, size) : x;
	sheet.page.drawText(safe, {
		x: left,
		y: sheet.y - size,
		size,
		font: style.bold ? sheet.bold : sheet.font,
		color: style.color ?? INK,
	});
}

/** `value` shortened with an ellipsis until it fits `max` points. */
export function fit(sheet: Sheet, value: string, max: number, size: number): string {
	const safe = sheet.safe(value);
	if (width(sheet, safe, size) <= max) return safe;
	const chars = Array.from(safe);
	while (chars.length > 1 && width(sheet, `${chars.join('')}...`, size) > max) chars.pop();
	return `${chars.join('').trimEnd()}...`;
}

function wrap(sheet: Sheet, value: string, max: number, size: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const word of sheet.safe(value).split(' ')) {
		const next = line ? `${line} ${word}` : word;
		if (line && width(sheet, next, size) > max) {
			lines.push(line);
			line = word;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}

export function paragraph(sheet: Sheet, value: string, size = 9, color = MUTED): void {
	for (const line of wrap(sheet, value, CONTENT_WIDTH, size)) {
		ensure(sheet, size * 1.5);
		text(sheet, line, MARGIN, { size, color });
		sheet.y -= size * 1.5;
	}
}

export function rule(sheet: Sheet, color = RULE, thickness = 0.5): void {
	sheet.page.drawLine({
		start: { x: MARGIN, y: sheet.y },
		end: { x: MARGIN + CONTENT_WIDTH, y: sheet.y },
		thickness,
		color,
	});
}

export function heading(sheet: Sheet, title: string): void {
	ensure(sheet, 60);
	sheet.y -= 14;
	text(sheet, title, MARGIN, { size: 13, bold: true });
	sheet.y -= 22;
}

export interface Column {
	label: string;
	x: number;
	right?: boolean;
}

export function tableHead(sheet: Sheet, columns: readonly Column[]): void {
	for (const column of columns) {
		text(sheet, column.label, column.x, { size: 8, color: MUTED, right: column.right === true });
	}
	sheet.y -= 14;
	rule(sheet, INK, 0.8);
	sheet.y -= 4;
}

/** A first A4 page with the Inter fonts embedded; `y` starts at the top margin. */
export async function createSheet(locale: Locale): Promise<Sheet> {
	const doc = await PDFDocument.create();
	doc.registerFontkit(fontkit);
	const [regular, semibold] = await loadFonts();
	const font = await doc.embedFont(regular, { subset: true });
	const bold = await doc.embedFont(semibold, { subset: true });
	return {
		doc,
		font,
		bold,
		safe: makeSafe(font),
		page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
		y: PAGE_HEIGHT - MARGIN,
		locale,
		widths: new Map(),
	};
}

/** Writes "n / total" at the bottom right of every page. */
export function drawPageNumbers(sheet: Sheet): void {
	const pages = sheet.doc.getPages();
	pages.forEach((page, index) => {
		const label = `${index + 1} / ${pages.length}`;
		const size = 8;
		page.drawText(label, {
			x: PAGE_WIDTH - MARGIN - width(sheet, label, size),
			y: MARGIN - 8,
			size,
			font: sheet.font,
			color: MUTED,
		});
	});
}
