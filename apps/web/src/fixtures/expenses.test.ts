import assert from 'node:assert/strict';
import test from 'node:test';

const { E2E_EXISTING_WG, getE2EWgFixture } = await import('./data');
const { buildE2EExpenses } = await import('./expenses');

test('buildE2EExpenses lists the newest expense first like the expenses API', () => {
	const fixture = getE2EWgFixture(E2E_EXISTING_WG.shareCode);
	assert.ok(fixture);
	const times = buildE2EExpenses(fixture).map((expense) => Date.parse(expense.occurredAt));
	assert.ok(times.length > 1);
	assert.deepEqual(
		times,
		[...times].sort((a, b) => b - a),
	);
});
