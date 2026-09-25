import { expect, test } from '@playwright/test';
import {
	filterSearchResults,
	filterSearchResultsByQuickFilter,
	searchWgItems,
} from '../src/core/reads/search';

test('module filters retain matches after another module has twelve matches', () => {
	const results = searchWgItems('Treffer', {
		shareCode: 'WGCODE01',
		currentMemberId: 'member-1',
		announcements: Array.from({ length: 12 }, (_, index) => ({
			id: `announcement-${index}`,
			content: `Treffer Pinnwand ${index}`,
			createdAt: '2026-09-25T12:00:00.000Z',
		})),
		chores: [],
		expenses: [],
		recurringExpenses: [],
		shoppingItems: [
			{
				id: 'shopping-match',
				name: 'Treffer Einkauf',
				quantity: null,
				boughtAt: null,
				addedByMemberId: 'member-1',
			},
		],
	});

	expect(filterSearchResults(results, ['einkauf'])).toMatchObject([
		{ id: 'shopping-match', module: 'einkauf', title: 'Treffer Einkauf' },
	]);
	expect(filterSearchResultsByQuickFilter(results, 'mine')).toContainEqual(
		expect.objectContaining({ id: 'shopping-match', module: 'einkauf' }),
	);
});

test('keeps all matches within the six API page limits', () => {
	const ids = Array.from({ length: 120 }, (_, index) => String(index));
	const results = searchWgItems('Treffer', {
		shareCode: 'WGCODE01',
		announcements: ids.map((id) => ({
			id: `announcement-${id}`,
			content: 'Treffer Pinnwand',
			createdAt: '2026-09-25T12:00:00.000Z',
		})),
		chores: ids.map((id) => ({
			id: `chore-${id}`,
			title: 'Treffer Putzplan',
			nextDueAt: '2026-09-25T12:00:00.000Z',
		})),
		expenses: ids.map((id) => ({
			id: `expense-${id}`,
			description: 'Treffer Ausgabe',
			amountCents: 100,
			occurredAt: '2026-09-25T12:00:00.000Z',
		})),
		recurringExpenses: ids.map((id) => ({
			id: `recurring-${id}`,
			description: 'Treffer Fixkosten',
			amountCents: 100,
			intervalMonths: 1,
			nextDueAt: '2026-09-25T12:00:00.000Z',
		})),
		shoppingItems: ids.map((id) => ({
			id: `shopping-${id}`,
			name: 'Treffer Einkauf',
			quantity: null,
			boughtAt: null,
		})),
		absences: ids.map((id) => ({
			id: `absence-${id}`,
			memberId: `member-${id}`,
			memberName: `Treffer Mitglied ${id}`,
			startDate: '2026-09-25T12:00:00.000Z',
			endDate: '2026-09-26T12:00:00.000Z',
			reason: null,
		})),
	});

	expect(results).toHaveLength(720);
});
