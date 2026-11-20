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

function unhiddenInlineSpinners(file: string): string[] {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const findings: string[] = [];
	const visit = (node: ts.Node) => {
		if (
			(ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
			node.tagName.getText(source) === 'Spinner'
		) {
			const names = node.attributes.properties.map((attr) =>
				ts.isJsxAttribute(attr) ? attr.name.getText(source) : '',
			);
			const inline = node.attributes.properties.some(
				(attr) =>
					ts.isJsxAttribute(attr) &&
					attr.name.getText(source) === 'data-icon' &&
					attr.initializer !== undefined &&
					ts.isStringLiteral(attr.initializer) &&
					attr.initializer.text === 'inline-start',
			);
			if (inline && !names.includes('aria-hidden')) {
				const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
				findings.push(`${relative(SRC, file)}:${line + 1}`);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return findings;
}

test('every inline-start Spinner is aria-hidden', () => {
	const findings = tsxFiles(SRC).flatMap(unhiddenInlineSpinners);
	assert.deepEqual(findings, []);
});
