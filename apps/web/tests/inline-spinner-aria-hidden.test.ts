import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import ts from '@typescript/typescript6';

// Spinner carries role="status" and an aria-label. Inside a button next to a visible label that
// name is folded into the button name ("Loading Saving…"), so inline spinners must be hidden.
const SRC = join(import.meta.dirname, '..', 'src');

function tsxFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) return tsxFiles(full);
		return entry.name.endsWith('.tsx') ? [full] : [];
	});
}

function attribute(node: ts.JsxOpeningLikeElement, name: string, source: ts.SourceFile) {
	return node.attributes.properties.find(
		(attr): attr is ts.JsxAttribute =>
			ts.isJsxAttribute(attr) && attr.name.getText(source) === name,
	);
}

/** Text of `"x"`, `{'x'}`, `{"x"}` or `{`x`}`; undefined for anything else. */
function literalText(value: ts.JsxAttributeValue | undefined): string | undefined {
	const literal = value && ts.isJsxExpression(value) ? value.expression : value;
	if (literal && (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal))) {
		return literal.text;
	}
	return undefined;
}

/** `aria-hidden`, `aria-hidden={true}` or `aria-hidden="true"`; anything else may leave it exposed. */
function hidesLiterally(attr: ts.JsxAttribute | undefined): boolean {
	if (!attr) return false;
	const value = attr.initializer;
	if (value === undefined) return true;
	if (literalText(value) !== undefined) return literalText(value) === 'true';
	return (
		ts.isJsxExpression(value) &&
		value.expression !== undefined &&
		value.expression.kind === ts.SyntaxKind.TrueKeyword
	);
}

/** Line numbers (1-based) of inline-start Spinners in `text` that are not aria-hidden. */
function unhiddenInlineSpinners(fileName: string, text: string): number[] {
	const source = ts.createSourceFile(
		fileName,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const lines: number[] = [];
	const visit = (node: ts.Node) => {
		if (
			(ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
			node.tagName.getText(source) === 'Spinner'
		) {
			const inline =
				literalText(attribute(node, 'data-icon', source)?.initializer) === 'inline-start';
			if (inline && !hidesLiterally(attribute(node, 'aria-hidden', source))) {
				lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return lines;
}

const spinner = (attrs: string) =>
	unhiddenInlineSpinners('case.tsx', `const el = <Spinner data-icon="inline-start" ${attrs} />;`);

for (const attrs of ['aria-hidden', 'aria-hidden={true}', 'aria-hidden="true"']) {
	test(`${attrs} hides the spinner`, () => assert.deepEqual(spinner(attrs), []));
}

for (const attrs of ['', 'aria-hidden={false}', 'aria-hidden="false"', 'aria-hidden={x}']) {
	test(`"${attrs}" is reported`, () => assert.deepEqual(spinner(attrs), [1]));
}

for (const icon of [`{'inline-start'}`, '{"inline-start"}', '{`inline-start`}']) {
	test(`data-icon=${icon} counts as inline-start`, () =>
		assert.deepEqual(
			unhiddenInlineSpinners('case.tsx', `const el = <Spinner data-icon=${icon} />;`),
			[1],
		));
}

test('multi-line JSX is reported at the line of the tag', () => {
	const text =
		'const el = (\n\t<Spinner\n\t\tclassName="x"\n\t\tdata-icon="inline-start"\n\t/>\n);';
	assert.deepEqual(unhiddenInlineSpinners('case.tsx', text), [2]);
});

test('every inline-start Spinner in src is aria-hidden', () => {
	const findings = tsxFiles(SRC).flatMap((file) =>
		unhiddenInlineSpinners(file, readFileSync(file, 'utf8')).map(
			(line) => `${relative(SRC, file)}:${line}`,
		),
	);
	assert.deepEqual(findings, []);
});
