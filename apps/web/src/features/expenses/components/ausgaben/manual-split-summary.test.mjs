import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('@/')) {
			const path = resolve(appRoot, 'src', `${specifier.slice(2)}.ts`);
			return nextResolve(pathToFileURL(path).href, context);
		}
		return nextResolve(specifier, context);
	},
});

const { distributeRemainderCents } = await import('./manual-split-distribute.ts');

const members = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('tops up empty fields when too little was entered', () => {
	const next = distributeRemainderCents({ a: '10,00' }, members, 2000);
	// 20€ split across the two empty members (b, c), 10€ each.
	assert.equal(next.b, '10,00');
	assert.equal(next.c, '10,00');
	assert.equal(next.a, '10,00');
});

test('claws excess back from filled fields instead of going negative', () => {
	// Regression: overshooting by 5€ used to target the empty "c" field,
	// driving it to -5,00 — a value the input can't parse back out, so it
	// silently vanished from the sum instead of fixing the overage.
	const next = distributeRemainderCents({ a: '15,00', b: '20,00' }, members, -500);
	assert.notEqual(next.c, '-5,00');
	assert.equal(next.c ?? '', '');
	// The 5€ excess is clawed back from the two filled fields (a, b).
	const totalCents = 1500 + 2000 - 500;
	const aCents = Math.round(Number.parseFloat(next.a.replace(',', '.')) * 100);
	const bCents = Math.round(Number.parseFloat(next.b.replace(',', '.')) * 100);
	assert.equal(aCents + bCents, totalCents);
	assert.ok(aCents >= 0 && bCents >= 0);
});

test('clamps a filled field at zero rather than going negative', () => {
	const next = distributeRemainderCents({ a: '2,00' }, [{ id: 'a' }], -500);
	assert.equal(next.a, '0,00');
});

test('no-op when the remainder is already zero', () => {
	const current = { a: '10,00', b: '10,00' };
	const next = distributeRemainderCents(current, members, 0);
	assert.deepEqual(next, current);
});
