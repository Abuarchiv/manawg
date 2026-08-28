import { describe, expect, it } from 'vitest';
import {
	type SplitMemberLike,
	buildSplitsFromForm,
	payerOptions,
	splitCandidates,
} from './expense-split-input';

const MINA = { id: 'mina', active: true };
const TOM = { id: 'tom', active: true };
const MOVED_OUT = { id: 'gone', active: false };
const ALL: SplitMemberLike[] = [MINA, TOM, MOVED_OUT];

function equal(overrides: Partial<Parameters<typeof buildSplitsFromForm>[0]> = {}) {
	return buildSplitsFromForm({
		splitMode: 'equal',
		members: ALL,
		manualSplits: {},
		amountCents: 1000,
		rotationOffset: 0,
		...overrides,
	});
}

function manual(manualSplits: Record<string, string>, amountCents: number) {
	return buildSplitsFromForm({
		splitMode: 'manual',
		members: ALL,
		manualSplits,
		amountCents,
		rotationOffset: 0,
	});
}

describe('buildSplitsFromForm — equal mode', () => {
	it('splits across active members only, leaving out anyone who moved out', () => {
		const result = equal();
		expect(result).toEqual({
			ok: true,
			splits: [
				{ debtorMemberId: 'mina', amountCents: 500 },
				{ debtorMemberId: 'tom', amountCents: 500 },
			],
		});
	});

	it('reports no_members when nobody is active', () => {
		expect(equal({ members: [MOVED_OUT] })).toEqual({ ok: false, reason: 'no_members' });
	});

	it('gives the leftover cent to a different member as the rotation offset advances', () => {
		const first = equal({ amountCents: 1001, rotationOffset: 0 });
		const second = equal({ amountCents: 1001, rotationOffset: 1 });
		expect(first).toMatchObject({ ok: true });
		expect(second).toMatchObject({ ok: true });

		const takesExtra = (r: ReturnType<typeof equal>) =>
			r.ok ? r.splits.find((s) => s.amountCents === 501)?.debtorMemberId : null;
		expect(takesExtra(first)).toBe('mina');
		expect(takesExtra(second)).toBe('tom');
	});

	it('always sums to the exact total', () => {
		for (const amount of [1, 3, 7, 999, 1001, 123_457]) {
			const result = equal({ amountCents: amount });
			expect(result.ok).toBe(true);
			if (!result.ok) continue;
			expect(result.splits.reduce((sum, s) => sum + s.amountCents, 0)).toBe(amount);
		}
	});
});

describe('buildSplitsFromForm — manual mode', () => {
	it('accepts euro strings with a comma and converts them to cents', () => {
		expect(manual({ mina: '7,50', tom: '2,50' }, 1000)).toEqual({
			ok: true,
			splits: [
				{ debtorMemberId: 'mina', amountCents: 750 },
				{ debtorMemberId: 'tom', amountCents: 250 },
			],
		});
	});

	it('keeps the share of a member who has since moved out', () => {
		const result = manual({ mina: '5,00', gone: '5,00' }, 1000);
		expect(result).toMatchObject({ ok: true });
		if (!result.ok) return;
		expect(result.splits.map((s) => s.debtorMemberId)).toEqual(['mina', 'gone']);
	});

	it('reports splits_empty when every row is blank', () => {
		expect(manual({ mina: '   ', tom: '' }, 1000)).toEqual({ ok: false, reason: 'splits_empty' });
	});

	it('reports splits_mismatch when the rows do not add up to the total', () => {
		expect(manual({ mina: '5,00', tom: '4,00' }, 1000)).toEqual({
			ok: false,
			reason: 'splits_mismatch',
		});
	});

	it('ignores unparseable rows rather than counting them as zero', () => {
		// 'abc' dropping out leaves only Mina's 10,00 — which matches the total,
		// so the result is valid rather than a mismatch against a phantom 0.
		expect(manual({ mina: '10,00', tom: 'abc' }, 1000)).toEqual({
			ok: true,
			splits: [{ debtorMemberId: 'mina', amountCents: 1000 }],
		});
	});
});

describe('payerOptions', () => {
	it('offers only active members', () => {
		expect(payerOptions(ALL, 'mina').map((m) => m.id)).toEqual(['mina', 'tom']);
	});

	it('adds the selected payer back when they have moved out', () => {
		expect(payerOptions(ALL, 'gone').map((m) => m.id)).toEqual(['mina', 'tom', 'gone']);
	});
});

describe('splitCandidates', () => {
	it('offers only active members in equal mode', () => {
		expect(splitCandidates(ALL, 'equal', { gone: '5,00' }).map((m) => m.id)).toEqual([
			'mina',
			'tom',
		]);
	});

	it('keeps a moved-out member in manual mode while they still carry an amount', () => {
		expect(splitCandidates(ALL, 'manual', { gone: '5,00' }).map((m) => m.id)).toEqual([
			'mina',
			'tom',
			'gone',
		]);
	});

	it('drops a moved-out member once their amount is cleared', () => {
		expect(splitCandidates(ALL, 'manual', { gone: '  ' }).map((m) => m.id)).toEqual([
			'mina',
			'tom',
		]);
	});
});
