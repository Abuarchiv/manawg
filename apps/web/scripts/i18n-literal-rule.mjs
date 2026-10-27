/**
 * i18n rules for scripts/check-architecture.mjs, built on the TypeScript AST.
 *
 *   i18n-literal         a source file with user-facing German copy outside the message catalogs
 *   i18n-catalog-import  a value import of the message catalogs outside the two server modules
 *
 * A line is exempt when it carries `i18n-ignore <reason>` (as `// i18n-ignore`, or inside a JSX
 * `{/* i18n-ignore *\/}`), or when the line above holds nothing but that marker comment.
 */

import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const IGNORE_MARKER = 'i18n-ignore';
const COPY_ATTRIBUTES = new Set([
	'aria-label',
	'placeholder',
	'title',
	'alt',
	'label',
	'description',
]);
/** Object keys whose capitalised string values are shown to people (labels, titles, toasts). */
const COPY_KEYS = new Set([...COPY_ATTRIBUTES, 'ariaLabel', 'heading', 'message', 'text']);
const ALLOWLIST_RE =
	/\b(?:ManaWG|Deutsch|English|PayPal|Splitwise|Splid|CSV|iOS|Android|Web Push)\b/g;
const ENTITY_RE = /&(?:#\d+|#x[\da-f]+|[a-z]+);/gi;
const UMLAUT_RE = /[äöüÄÖÜß]/;
const GERMAN_WORD_RE =
	/\b(und|nicht|wird|werden|wenn|damit|oder|auch|noch|sonst|bereits|immer|keine?|sind|ist|dass|weil|beim|nach|soll|muss|kann|bei|zum|zur|eine?n?|der|das|dem|den|für|über|wäre|hält|müssen|können|würde)\b/i;
/** Capitalised UI nouns and verbs that appear as whole words in screens, toasts and labels. */
const GERMAN_UI_WORDS = [
	'Abbrechen',
	'Abmelden',
	'Abrechnung',
	'Anmelden',
	'Abwesenheit',
	'Aufgabe',
	'Aufgaben',
	'Ausgabe',
	'Ausgaben',
	'Benachrichtigungen',
	'Bearbeiten',
	'Bezahlt',
	'Einkauf',
	'Einkaufsliste',
	'Einladen',
	'Einladung',
	'Einladungen',
	'Einstellungen',
	'Erinnerungen',
	'Erledigt',
	'Fehler',
	'Fixkosten',
	'Gestern',
	'Haushalt',
	'Heute',
	'Jemand',
	'Kalender',
	'Mitbewohner',
	'Mitglieder',
	'Monatsabrechnung',
	'Nachricht',
	'Niemand',
	'Offen',
	'Passwort',
	'Pinnwand',
	'Profil',
	'Putzplan',
	'Registrieren',
	'Schulden',
	'Senden',
	'Speichern',
	'Teilen',
	'Termin',
	'Termine',
	'Unbekannt',
	'Weiter',
	'Zahlungen',
	'Zugang',
];
const GERMAN_UI_RE = new RegExp(`\\b(?:${GERMAN_UI_WORDS.join('|')})\\b`);

const CATALOG_DIR = join('shared', 'i18n', 'messages');
const CATALOG_IMPORTERS = new Set(['src/i18n/request.ts', 'src/core/i18n/server-t.ts']);
const LITERAL_EXEMPT_PREFIXES = ['src/shared/i18n/messages/', 'src/fixtures/'];
const LITERAL_EXEMPT_FILES = new Set(['src/app/opengraph-image.tsx']);

const letterCount = (text) => (text.match(/\p{L}/gu) ?? []).length;

function copyLetters(text) {
	return letterCount(text.replace(ENTITY_RE, ' ').replace(ALLOWLIST_RE, ' '));
}

function isGerman(text) {
	if (UMLAUT_RE.test(text) || GERMAN_UI_RE.test(text)) return true;
	return /\s/.test(text.trim()) && GERMAN_WORD_RE.test(text);
}

function isModuleSpecifier(node) {
	const parent = node.parent;
	if (!parent) return false;
	if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
	if (ts.isExternalModuleReference(parent)) return true;
	if (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) return true;
	return (
		ts.isCallExpression(parent) &&
		(parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
			(ts.isIdentifier(parent.expression) && parent.expression.text === 'require'))
	);
}

function parse(r, source) {
	const kind = r.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	return ts.createSourceFile(r, source, ts.ScriptTarget.Latest, true, kind);
}

/** True when `r` is a non-test `.ts`/`.tsx` file that is checked for German copy. */
export function isLiteralChecked(r) {
	if (!/\.tsx?$/.test(r) || r.endsWith('.d.ts')) return false;
	if (LITERAL_EXEMPT_FILES.has(r)) return false;
	return !LITERAL_EXEMPT_PREFIXES.some((prefix) => r.startsWith(prefix));
}

/** Findings `{ line, kind, text }` for user-facing German copy outside the catalogs. */
export function literalFindings(r, source) {
	const sourceFile = parse(r, source);
	const lines = source.split('\n');
	const found = [];
	const report = (pos, kind, text) => {
		const line = sourceFile.getLineAndCharacterOfPosition(pos).line;
		const above = lines[line - 1]?.trim() ?? '';
		const markerAbove = above.includes(IGNORE_MARKER) && /^(\/\/|\{?\/\*)/.test(above);
		if (lines[line].includes(IGNORE_MARKER) || markerAbove) return;
		found.push({ line: line + 1, kind, text: text.trim().slice(0, 60) });
	};

	const visit = (node) => {
		if (ts.isJsxText(node)) {
			if (copyLetters(node.text) >= 2) {
				report(node.pos + Math.max(0, node.text.search(/\S/)), 'jsx-text', node.text);
			}
		} else if (ts.isJsxAttribute(node) && COPY_ATTRIBUTES.has(node.name.getText())) {
			const init = node.initializer;
			const value = init && ts.isJsxExpression(init) ? init.expression : init;
			if (value && ts.isStringLiteralLike(value) && copyLetters(value.text) >= 2) {
				report(value.getStart(), 'attribute', value.text);
			}
		} else if (
			ts.isPropertyAssignment(node) &&
			COPY_KEYS.has(node.name.getText().replace(/^['"]|['"]$/g, ''))
		) {
			const value = node.initializer;
			if (
				ts.isStringLiteralLike(value) &&
				/^\p{Lu}/u.test(value.text.trim()) &&
				copyLetters(value.text) >= 2
			) {
				report(value.getStart(), 'property', value.text);
			}
		} else if (
			(ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
			!isModuleSpecifier(node)
		) {
			if (isGerman(node.text)) report(node.getStart(), 'german-literal', node.text);
		} else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
			if (isGerman(node.text)) report(node.getStart(), 'german-literal', node.text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return found;
}

/** Specifiers of value imports (not `import type`) in `source`, including re-exports and `import()`. */
function valueSpecifiers(sourceFile) {
	const out = [];
	const visit = (node) => {
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			const clause = node.importClause;
			const named = clause?.namedBindings;
			const typeOnly =
				clause?.isTypeOnly ||
				(clause &&
					!clause.name &&
					named &&
					ts.isNamedImports(named) &&
					named.elements.length > 0 &&
					named.elements.every((el) => el.isTypeOnly));
			if (!typeOnly) out.push(node.moduleSpecifier.text);
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
			out.push(node.moduleSpecifier.text);
		} else if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			ts.isStringLiteralLike(node.arguments[0])
		) {
			out.push(node.arguments[0].text);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return out;
}

/** Value imports of the message catalogs from a module that may not read them. */
export function catalogImportFindings(file, r, source, srcRoot) {
	if (CATALOG_IMPORTERS.has(r) || r.startsWith('src/shared/i18n/messages/')) return [];
	if (!source.includes('messages')) return [];
	const catalogRoot = join(srcRoot, CATALOG_DIR);
	return valueSpecifiers(parse(r, source)).filter((specifier) => {
		let target = null;
		if (specifier.startsWith('@/')) target = join(srcRoot, specifier.slice(2));
		else if (specifier.startsWith('.')) target = resolve(dirname(file), specifier);
		if (!target) return false;
		const inside = relative(catalogRoot, target);
		return !inside.startsWith('..') && !inside.startsWith(sep);
	});
}
