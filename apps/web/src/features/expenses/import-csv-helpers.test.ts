import assert from 'node:assert/strict';
import test from 'node:test';

const { parseDecimal, splitProportionally } = await import('./import-csv-helpers');

function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 2 ** 32;
		return state / 2 ** 32;
	};
}

test('splitProportionally: shares that already add up to the total come back unchanged', () => {
	const random = seeded(984);
	for (let run = 0; run < 5000; run += 1) {
		const count = 2 + Math.floor(random() * 4);
		const cents = Array.from({ length: count }, () => 1 + Math.floor(random() * 500_000));
		const total = cents.reduce((acc, n) => acc + n, 0);
		const { splits, drifted } = splitProportionally(
			total,
			cents.map((c, i) => ({ memberName: `m${i}`, weight: c / 100 })),
		);
		assert.deepEqual(
			splits.map((s) => s.amountCents),
			cents,
		);
		assert.equal(drifted, false);
	}
});

test('splitProportionally: sub-cent shares give the extra cent to the first, ratios scale to the total', () => {
	const sub = splitProportionally(811, [
		{ memberName: 'a', weight: 4.055 },
		{ memberName: 'b', weight: 4.055 },
	]);
	assert.deepEqual(
		sub.splits.map((s) => s.amountCents),
		[406, 405],
	);
	const ratio = splitProportionally(1000, [
		{ memberName: 'a', weight: 1 },
		{ memberName: 'b', weight: 2 },
	]);
	assert.deepEqual(
		ratio.splits.map((s) => s.amountCents),
		[333, 667],
	);
});

test('parseDecimal: the last separator is the decimal mark when both appear', () => {
	assert.equal(parseDecimal('1.234,56'), 1234.56);
	assert.equal(parseDecimal('1,234.56'), 1234.56);
	assert.equal(parseDecimal('4.055'), 4.055);
	assert.equal(parseDecimal('12,5'), 12.5);
});
