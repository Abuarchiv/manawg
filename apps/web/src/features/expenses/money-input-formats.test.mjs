import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = fileURLToPath(new URL('../../..', import.meta.url));
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier.startsWith('@/')) {
			const path = resolve(appRoot, 'src', `${specifier.slice(2)}.ts`);
			return nextResolve(pathToFileURL(path).href, context);
		}
		return nextResolve(specifier, context);
	},
});

const { parseEuroAmount } = await import('../../core/utils/amount.ts');
const { parseSplitwiseCsv } = await import('./import-parsers.ts');

test('parseEuroAmount accepts pasted euro formats and rejects ambiguous ones', () => {
	const ok = {
		'1.234,50': 1234.5,
		'1234.5': 1234.5,
		'12,': 12,
		'1 234,50': 1234.5,
		'1 234,50': 1234.5,
		'1234,50 €': 1234.5,
		'€1234,5': 1234.5,
		'12,50 EUR': 12.5,
		',5': 0.5,
		'.5': 0.5,
		'999.999,99': 999999.99,
	};
	for (const [raw, euros] of Object.entries(ok)) assert.equal(parseEuroAmount(raw), euros, raw);
	for (const raw of ['-5', '1 2', '12,345', '1,234', 'abc', '', '€', '1e3']) {
		assert.equal(parseEuroAmount(raw), null, raw);
	}
});

test('parseSplitwiseCsv reads decimal commas as euros, not as thousands', () => {
	const total = (amount) =>
		parseSplitwiseCsv(
			`Datum;Beschreibung;Kosten;Währung;Anna;Bob\n2026-01-15;X;"${amount}";EUR;"${amount}";"-1"\n`,
		)[0]?.amountCents;
	assert.equal(total('12,5'), 1250);
	assert.equal(total('0,5'), 50);
	assert.equal(total('12,50'), 1250);
	assert.equal(total('1.234,50'), 123450);
	assert.equal(total('1,234.50'), 123450);
	assert.equal(total('1.234'), 123400);
	assert.equal(total('1,234'), 123400);
	assert.equal(total('€ 1 234,50'), 123450);
	// Sub-cent digits are rejected instead of being rounded away silently.
	assert.equal(total('12,345.678'), undefined);
});
