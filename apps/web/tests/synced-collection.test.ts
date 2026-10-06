import assert from 'node:assert/strict';
import test from 'node:test';

const { applyPendingOverlay, loadErrorMessage } = await import(
	'../src/core/sync/collection-overlay.ts'
);

interface Row {
	id: string;
	label: string;
}

const getId = (row: Row) => row.id;

test('without pending rows the server list is shown as is', () => {
	const server: Row[] = [{ id: 'a', label: 'server' }];
	assert.equal(applyPendingOverlay(server, new Map(), getId), server);
});

test('pending rows replace known rows in place and new ones are listed first', () => {
	const server: Row[] = [
		{ id: 'a', label: 'server a' },
		{ id: 'b', label: 'server b' },
	];
	const pending = new Map<string, Row>([
		['b', { id: 'b', label: 'checked off' }],
		['tmp-1', { id: 'tmp-1', label: 'just added' }],
	]);
	assert.deepEqual(applyPendingOverlay(server, pending, getId), [
		{ id: 'tmp-1', label: 'just added' },
		{ id: 'a', label: 'server a' },
		{ id: 'b', label: 'checked off' },
	]);
});

test('a load error is shown unless the feature keeps its data on screen', () => {
	const error = { status: 0, error: 'Netzwerkfehler' };
	const describe = () => 'Liste konnte nicht geladen werden.';
	const hideSilent = (_: unknown, context: { silent: boolean; hasData: boolean }) =>
		context.silent && context.hasData;

	assert.equal(
		loadErrorMessage(error, { silent: true, hasData: true }, describe, undefined),
		'Liste konnte nicht geladen werden.',
	);
	assert.equal(
		loadErrorMessage(error, { silent: true, hasData: true }, describe, hideSilent),
		null,
	);
	assert.equal(
		loadErrorMessage(error, { silent: false, hasData: true }, describe, hideSilent),
		'Liste konnte nicht geladen werden.',
	);
	assert.equal(
		loadErrorMessage(error, { silent: true, hasData: false }, describe, hideSilent),
		'Liste konnte nicht geladen werden.',
	);
});
