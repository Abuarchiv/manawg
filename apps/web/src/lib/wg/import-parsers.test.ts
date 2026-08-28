import { describe, expect, it } from 'vitest';
import {
	UnsupportedCurrencyError,
	collectUniqueNames,
	findMappingConflicts,
	matchMembers,
	normalizeMemberName,
	parseSplidCsv,
	parseSplitwiseCsv,
} from './import-parsers';

const SPLITWISE_SAMPLE = `Date,Description,Category,Cost,Currency,Lisa,Tom,Anna
2026-04-01,Pizza,Food,30.00,EUR,20.00,-10.00,-10.00
2026-04-03,"Mietnebenkosten, April",Utilities,150.00,EUR,-50.00,-50.00,100.00
2026-04-05,Kino,Entertainment,24.00,EUR,-12.00,12.00,0.00
2026-04-10,"Quote ""special""",Misc,9.99,EUR,9.99,0.00,0.00
Total balance,,,,,5.00,-3.00,-2.00`;

const SPLITWISE_BOM_SAMPLE = `﻿Date,Description,Category,Cost,Currency,Lisa,Tom
2026-05-01,Brot,Food,4.50,EUR,4.50,0.00`;

const SPLID_SAMPLE = `Datum;Beschreibung;Betrag;Bezahlt von;Teilnehmer
01.04.2026;Pizza;30,00;Lisa;Lisa,Tom,Anna
03.04.2026;"Mietnebenkosten, April";150,00;Anna;Lisa,Tom,Anna
05.04.2026;Kino;24,00;Tom;Lisa,Tom
10.04.2026;Eis;3,50;Lisa;Lisa`;

describe('normalizeMemberName', () => {
	it('lowercases trims and removes diacritics', () => {
		expect(normalizeMemberName('  Müller  ')).toBe('muller');
		expect(normalizeMemberName('Élodie')).toBe('elodie');
		expect(normalizeMemberName('Tom\t')).toBe('tom');
	});

	it('collapses internal whitespace', () => {
		expect(normalizeMemberName('Anna   Maria')).toBe('anna maria');
	});
});

describe('matchMembers', () => {
	const members = [
		{ id: 'id-lisa', name: 'Lisa' },
		{ id: 'id-tom', name: 'Tom' },
		{ id: 'id-anna', name: 'Anna Müller' },
	];

	it('returns exact matches', () => {
		const map = matchMembers(['Lisa', 'Tom'], members);
		expect(map.get('Lisa')).toBe('id-lisa');
		expect(map.get('Tom')).toBe('id-tom');
	});

	it('fuzzy matches within distance 2', () => {
		const map = matchMembers(['Lsa', 'Anna Muller'], members);
		expect(map.get('Lsa')).toBe('id-lisa');
		expect(map.get('Anna Muller')).toBe('id-anna');
	});

	it('returns null for ambiguous equal-distance fuzzy matches', () => {
		const map = matchMembers(
			['Anni'],
			[
				{ id: 'id-anna', name: 'Anna' },
				{ id: 'id-anne', name: 'Anne' },
			],
		);

		expect(map.get('Anni')).toBeNull();
	});

	it('keeps exact matches when nearby fuzzy alternatives exist', () => {
		const map = matchMembers(
			['Anna'],
			[
				{ id: 'id-anna', name: 'Anna' },
				{ id: 'id-anne', name: 'Anne' },
			],
		);

		expect(map.get('Anna')).toBe('id-anna');
	});

	it('keeps the single best fuzzy match when it is not ambiguous', () => {
		const map = matchMembers(
			['Annee'],
			[
				{ id: 'id-anna', name: 'Anna' },
				{ id: 'id-anne', name: 'Anne' },
			],
		);

		expect(map.get('Annee')).toBe('id-anne');
	});

	it('returns null when no match is close enough', () => {
		const map = matchMembers(['Zacharias'], members);
		expect(map.get('Zacharias')).toBeNull();
	});

	it('returns null for empty input', () => {
		const map = matchMembers([''], members);
		expect(map.get('')).toBeNull();
	});
});

describe('parseSplitwiseCsv', () => {
	it('parses standard rows into ParsedExpense entries', () => {
		const result = parseSplitwiseCsv(SPLITWISE_SAMPLE);
		expect(result).toHaveLength(4);
		const pizza = result[0];
		if (!pizza) throw new Error('expected first row');
		expect(pizza.description).toBe('Pizza');
		expect(pizza.amountCents).toBe(3000);
		expect(pizza.paidByName).toBe('Lisa');
		expect(pizza.splits.map((s) => s.memberName)).toEqual(['Lisa', 'Tom', 'Anna']);
		expect(pizza.splits.reduce((acc, s) => acc + s.amountCents, 0)).toBe(3000);
	});

	it('handles quoted descriptions with commas and escaped quotes', () => {
		const result = parseSplitwiseCsv(SPLITWISE_SAMPLE);
		const utilities = result[1];
		const quoted = result[3];
		if (!utilities || !quoted) throw new Error('expected rows');
		expect(utilities.description).toBe('Mietnebenkosten, April');
		expect(utilities.paidByName).toBe('Anna');
		expect(quoted.description).toBe('Quote "special"');
	});

	it('skips Total balance summary rows', () => {
		const result = parseSplitwiseCsv(SPLITWISE_SAMPLE);
		expect(result.every((r) => !/^total/i.test(r.description))).toBe(true);
	});

	it('strips UTF-8 BOM at start', () => {
		const result = parseSplitwiseCsv(SPLITWISE_BOM_SAMPLE);
		expect(result).toHaveLength(1);
		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.paidByName).toBe('Lisa');
		expect(row.amountCents).toBe(450);
	});

	it('returns empty array for malformed CSV (missing columns)', () => {
		expect(parseSplitwiseCsv('foo,bar\nbaz,qux')).toEqual([]);
	});

	it('throws UnsupportedCurrencyError when a row currency is not EUR', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
2026-04-01,Coffee,5.00,USD,5.00,0.00`;
		expect(() => parseSplitwiseCsv(csv)).toThrowError(UnsupportedCurrencyError);
		try {
			parseSplitwiseCsv(csv);
		} catch (err) {
			if (!(err instanceof UnsupportedCurrencyError)) throw err;
			expect(err.currency).toBe('USD');
			expect(err.message).toBe('Nur EUR-Importe unterstützt');
		}
	});

	it('throws UnsupportedCurrencyError for GBP', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
2026-04-01,Tea,3.00,GBP,3.00,0.00`;
		expect(() => parseSplitwiseCsv(csv)).toThrowError(UnsupportedCurrencyError);
	});

	it('RED BUG-371: rejects non-EUR values when Splitwise exports the German Währung header', () => {
		const csv = `Datum,Beschreibung,Kosten,Währung,Lisa,Tom
2026-04-01,Kaffee,5.00,USD,5.00,0.00`;
		expect(() => parseSplitwiseCsv(csv)).toThrowError(UnsupportedCurrencyError);
	});

	it('RED BUG-372: preserves custom Splitwise member split amounts instead of equal-splitting', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
2026-04-01,Unequal dinner,100.00,EUR,70.00,-30.00`;
		const result = parseSplitwiseCsv(csv);

		expect(result).toHaveLength(1);
		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.splits).toEqual([
			{ memberName: 'Lisa', amountCents: 7000 },
			{ memberName: 'Tom', amountCents: 3000 },
		]);
	});

	it('RED BUG-373: excludes zero-value Splitwise member columns from custom splits', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
2026-04-01,Solo purchase,100.00,EUR,100.00,0.00`;
		const result = parseSplitwiseCsv(csv);

		expect(result).toHaveLength(1);
		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.splits).toEqual([{ memberName: 'Lisa', amountCents: 10000 }]);
	});

	it('RED BUG-375: treats slash dates in Splitwise CSV as US month/day/year dates', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
04/01/2026,April rent,100.00,EUR,100.00,0.00`;
		const result = parseSplitwiseCsv(csv);

		expect(result).toHaveLength(1);
		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.date).toBe('2026-04-01T00:00:00.000Z');
	});

	it('rejects impossible ISO calendar dates instead of rolling them forward', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
2026-02-31,Impossible rent,100.00,EUR,100.00,0.00
2026-02-28,Valid rent,100.00,EUR,100.00,0.00`;
		const result = parseSplitwiseCsv(csv);

		expect(result).toHaveLength(1);
		expect(result[0]?.description).toBe('Valid rent');
		expect(result[0]?.date).toBe('2026-02-28T00:00:00.000Z');
	});

	it('rejects impossible slash calendar dates instead of rolling them forward', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
02/31/2026,Impossible rent,100.00,EUR,100.00,0.00
02/28/2026,Valid rent,100.00,EUR,100.00,0.00`;
		const result = parseSplitwiseCsv(csv);

		expect(result).toHaveLength(1);
		expect(result[0]?.description).toBe('Valid rent');
		expect(result[0]?.date).toBe('2026-02-28T00:00:00.000Z');
	});

	it('RED BUG-376: rejects Splitwise amounts above the integer cents storage limit', () => {
		const csv = `Date,Description,Cost,Currency,Lisa
2026-04-01,Manipulated mansion,999999999.99,EUR,999999999.99`;

		expect(parseSplitwiseCsv(csv)).toEqual([]);
	});

	it('RED BUG-377: ignores unknown text columns instead of creating phantom members', () => {
		const csv = `Date,Description,Notes,Details,Cost,Currency,Lisa,Tom
2026-04-01,Pizza,extra cheese,,30.00,EUR,20.00,-10.00`;
		const result = parseSplitwiseCsv(csv);

		expect(result).toHaveLength(1);
		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.paidByName).toBe('Lisa');
		expect(row.splits.map((s) => s.memberName)).toEqual(['Lisa', 'Tom']);
	});

	it('RED BUG-377: warns when an unrecognized column without amounts is skipped', () => {
		const csv = `Date,Description,Foo,Cost,Currency,Lisa,Tom
2026-04-01,Pizza,bar,30.00,EUR,20.00,-10.00`;
		const result = parseSplitwiseCsv(csv);

		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.warnings).toContain('unknown_columns_ignored:Foo');
	});

	it('RED BUG-378: keeps custom splits within cent tolerance and concentrates drift on largest share', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
2026-04-01,Rounding dinner,100.00,EUR,70.00,29.99`;
		const result = parseSplitwiseCsv(csv);

		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.splits).toEqual([
			{ memberName: 'Lisa', amountCents: 7001 },
			{ memberName: 'Tom', amountCents: 2999 },
		]);
		expect(row.warnings).toContain('custom_splits_drift_adjusted');
	});

	it('RED BUG-378: discards custom splits beyond cent tolerance with a warning', () => {
		const csv = `Date,Description,Cost,Currency,Lisa,Tom
2026-04-01,Mismatch dinner,100.00,EUR,50.00,49.00`;
		const result = parseSplitwiseCsv(csv);

		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.warnings).toContain('custom_splits_discarded');
		expect(row.splits.reduce((acc, s) => acc + s.amountCents, 0)).toBe(10000);
	});

	it('RED BUG-379: rejects implausible years and keeps valid rows', () => {
		const csv = `Date,Description,Cost,Currency,Lisa
12.5.999,Medieval rent,100.00,EUR,100.00
1999-12-31,Y2K party,100.00,EUR,100.00
01.04.26,Two digit year,100.00,EUR,100.00`;
		const result = parseSplitwiseCsv(csv);

		expect(result).toHaveLength(1);
		expect(result[0]?.description).toBe('Two digit year');
		expect(result[0]?.date).toBe('2026-04-01T00:00:00.000Z');
	});
});

describe('parseSplidCsv', () => {
	it('parses German semicolon-delimited CSV with comma decimals', () => {
		const result = parseSplidCsv(SPLID_SAMPLE);
		expect(result).toHaveLength(4);
		const pizza = result[0];
		if (!pizza) throw new Error('expected first row');
		expect(pizza.description).toBe('Pizza');
		expect(pizza.amountCents).toBe(3000);
		expect(pizza.paidByName).toBe('Lisa');
		expect(pizza.splits).toHaveLength(3);
		expect(pizza.splits.reduce((acc, s) => acc + s.amountCents, 0)).toBe(3000);
	});

	it('handles quoted descriptions with embedded commas', () => {
		const result = parseSplidCsv(SPLID_SAMPLE);
		const utilities = result[1];
		if (!utilities) throw new Error('expected row');
		expect(utilities.description).toBe('Mietnebenkosten, April');
	});

	it('parses dd.mm.yyyy dates into ISO strings', () => {
		const result = parseSplidCsv(SPLID_SAMPLE);
		const first = result[0];
		if (!first) throw new Error('expected row');
		expect(first.date.startsWith('2026-04-01')).toBe(true);
	});

	it('defaults participants to payer when column is empty', () => {
		const csv = `Datum;Beschreibung;Betrag;Bezahlt von;Teilnehmer
01.04.2026;Solo;5,00;Lisa;`;
		const result = parseSplidCsv(csv);
		expect(result).toHaveLength(1);
		const solo = result[0];
		if (!solo) throw new Error('expected row');
		expect(solo.splits).toEqual([{ memberName: 'Lisa', amountCents: 500 }]);
	});

	it('returns empty array when required columns are missing', () => {
		expect(parseSplidCsv('a;b;c\n1;2;3')).toEqual([]);
	});

	it('throws UnsupportedCurrencyError when Splid Währung column is not EUR', () => {
		const csv = `Datum;Beschreibung;Betrag;Bezahlt von;Teilnehmer;Währung
01.04.2026;Pizza;30,00;Lisa;Lisa,Tom;USD`;
		expect(() => parseSplidCsv(csv)).toThrowError(UnsupportedCurrencyError);
	});

	it('rounds remainder cents into first participants', () => {
		const csv = `Datum;Beschreibung;Betrag;Bezahlt von;Teilnehmer
01.04.2026;Dreiteilung;1,00;Lisa;Lisa,Tom,Anna`;
		const result = parseSplidCsv(csv);
		const row = result[0];
		if (!row) throw new Error('expected row');
		expect(row.splits.reduce((acc, s) => acc + s.amountCents, 0)).toBe(100);
		expect(row.splits.map((s) => s.amountCents)).toEqual([34, 33, 33]);
	});

	it('rejects impossible German calendar dates instead of rolling them forward', () => {
		const csv = `Datum;Beschreibung;Betrag;Bezahlt von;Teilnehmer
31.02.2026;Impossible rent;100,00;Lisa;Lisa,Tom
28.02.2026;Valid rent;100,00;Lisa;Lisa,Tom`;
		const result = parseSplidCsv(csv);

		expect(result).toHaveLength(1);
		expect(result[0]?.description).toBe('Valid rent');
		expect(result[0]?.date).toBe('2026-02-28T00:00:00.000Z');
	});
});

describe('collectUniqueNames', () => {
	it('returns deduplicated set of all referenced names', () => {
		const parsed = parseSplidCsv(SPLID_SAMPLE);
		const names = collectUniqueNames(parsed);
		expect(names.sort()).toEqual(['Anna', 'Lisa', 'Tom']);
	});
});

describe('findMappingConflicts', () => {
	it('returns names without a mapped uuid', () => {
		const parsed = parseSplidCsv(SPLID_SAMPLE);
		const conflicts = findMappingConflicts(parsed, {
			Lisa: 'id-lisa',
			Tom: null,
			Anna: 'id-anna',
		});
		expect(conflicts).toEqual(['Tom']);
	});

	it('returns empty when mapping is complete', () => {
		const parsed = parseSplidCsv(SPLID_SAMPLE);
		const conflicts = findMappingConflicts(parsed, {
			Lisa: 'id-lisa',
			Tom: 'id-tom',
			Anna: 'id-anna',
		});
		expect(conflicts).toEqual([]);
	});
});
