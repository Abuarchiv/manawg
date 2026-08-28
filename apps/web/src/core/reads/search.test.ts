import { describe, expect, it } from 'vitest';
import {
	filterSearchResults,
	filterSearchResultsByQuickFilter,
	getSearchSuggestions,
	groupSearchResults,
	highlightSearchMatch,
	searchWgItems,
} from './search';

describe('searchWgItems', () => {
	it('returns matches across modules with stable hrefs', () => {
		const results = searchWgItems('milch', {
			shareCode: 'ABC12345',
			announcements: [{ id: 'a1', content: 'Bitte Milch kaufen', createdAt: '2026-05-18' }],
			chores: [{ id: 'c1', title: 'Bad putzen', nextDueAt: '2026-05-18' }],
			expenses: [
				{ id: 'e1', description: 'Milch und Brot', amountCents: 420, occurredAt: '2026-05-18' },
			],
			recurringExpenses: [
				{
					id: 'r1',
					description: 'Internet',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt: '2026-05-18',
				},
			],
			shoppingItems: [{ id: 's1', name: 'Hafermilch', quantity: '2x', boughtAt: null }],
			absences: [],
		});

		expect(results.map((result) => [result.module, result.href])).toEqual([
			['pinnwand', '/wg/ABC12345/pinnwand#announcement-a1'],
			['ausgaben', '/wg/ABC12345/ausgaben?highlight=e1'],
			['einkauf', '/wg/ABC12345/einkauf?highlight=s1'],
		]);
	});

	it('encodes entity ids in search result links', () => {
		const results = searchWgItems('milch', {
			shareCode: 'WG/123?x=1',
			announcements: [
				{
					id: 'pin/1?focus=comments',
					content: 'Milch kaufen',
					createdAt: '2026-05-18',
				},
			],
			chores: [{ id: 'chore 1&tab=all', title: 'Milch wegwischen', nextDueAt: '2026-05-18' }],
			expenses: [
				{
					id: 'expense 1&open=true',
					description: 'Milch',
					amountCents: 420,
					occurredAt: '2026-05-18',
				},
			],
			recurringExpenses: [
				{
					id: 'recurring 1&edit=true',
					description: 'Milch-Abo',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt: '2026-05-18',
				},
			],
			shoppingItems: [
				{ id: 'shopping 1&open=true', name: 'Hafermilch', quantity: '2x', boughtAt: null },
			],
			absences: [
				{
					id: 'absence 1&panel=bad',
					memberId: 'm1',
					memberName: 'Milena',
					startDate: '2026-05-18T00:00:00.000Z',
					endDate: '2026-05-20T23:59:59.000Z',
					reason: 'Milchreise',
				},
			],
		});

		expect(results.map((result) => [result.module, result.href])).toEqual([
			['pinnwand', '/wg/WG%2F123%3Fx%3D1/pinnwand#announcement-pin%2F1%3Ffocus%3Dcomments'],
			['putzen', '/wg/WG%2F123%3Fx%3D1/putzen?highlight=chore%201%26tab%3Dall'],
			['ausgaben', '/wg/WG%2F123%3Fx%3D1/ausgaben?highlight=expense%201%26open%3Dtrue'],
			['fixkosten', '/wg/WG%2F123%3Fx%3D1/ausgaben?recurring=recurring%201%26edit%3Dtrue'],
			['einkauf', '/wg/WG%2F123%3Fx%3D1/einkauf?highlight=shopping%201%26open%3Dtrue'],
			[
				'abwesenheiten',
				'/wg/WG%2F123%3Fx%3D1/putzen?panel=absences&absence=absence%201%26panel%3Dbad',
			],
		]);
	});

	it('finds recurring fixed costs as their own module', () => {
		const results = searchWgItems('internet', {
			shareCode: 'ABC12345',
			announcements: [],
			chores: [],
			expenses: [],
			recurringExpenses: [
				{
					id: 'r1',
					description: 'Internet',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt: '2026-05-18',
					paidByMemberId: 'm1',
				},
			],
			shoppingItems: [],
			absences: [],
			currentMemberId: 'm1',
		});

		expect(results).toMatchObject([
			{
				id: 'r1',
				module: 'fixkosten',
				title: 'Internet',
				meta: '32,90 € · monatlich',
				href: '/wg/ABC12345/ausgaben?recurring=r1',
				tags: expect.arrayContaining(['mine']),
			},
		]);
	});

	it('does not mark invalid due dates as overdue in search tags', () => {
		const results = searchWgItems('internet', {
			shareCode: 'ABC12345',
			announcements: [],
			chores: [{ id: 'c1', title: 'Internet-Router putzen', nextDueAt: 'broken' }],
			expenses: [],
			recurringExpenses: [
				{
					id: 'r1',
					description: 'Internet',
					amountCents: 3290,
					intervalMonths: 1,
					nextDueAt: 'broken',
				},
			],
			shoppingItems: [],
			absences: [],
		});

		expect(results.map((result) => [result.id, result.tags])).toEqual([
			['c1', []],
			['r1', []],
		]);
	});

	it('filters results by quick tags', () => {
		expect(
			filterSearchResultsByQuickFilter(
				[
					{ id: '1', module: 'pinnwand', title: 'A', meta: 'Pinnwand', href: '#', tags: ['open'] },
					{
						id: '2',
						module: 'ausgaben',
						title: 'B',
						meta: 'Ausgaben',
						href: '#',
						tags: ['unpaid'],
					},
				],
				'unpaid',
			).map((result) => result.id),
		).toEqual(['2']);
	});

	it('marks expenses as unpaid only when split data has open shares', () => {
		const results = searchWgItems('miete', {
			shareCode: 'ABC12345',
			announcements: [],
			chores: [],
			expenses: [
				{
					id: 'open',
					description: 'Miete offen',
					amountCents: 50000,
					occurredAt: '2026-05-18',
					splits: [{ settledAt: '2026-05-19T10:00:00.000Z' }, { settledAt: null }],
				},
				{
					id: 'settled',
					description: 'Miete bezahlt',
					amountCents: 50000,
					occurredAt: '2026-05-18',
					splits: [{ settledAt: '2026-05-19T10:00:00.000Z' }],
				},
				{
					id: 'legacy',
					description: 'Miete alt',
					amountCents: 50000,
					occurredAt: '2026-05-18',
				},
			],
			recurringExpenses: [],
			shoppingItems: [],
			absences: [],
		});

		expect(results.map((result) => [result.id, result.tags])).toEqual([
			['open', ['unpaid']],
			['settled', []],
			['legacy', ['unpaid']],
		]);
	});

	it('groups results by module for scan-friendly rendering', () => {
		const results = searchWgItems('milch', {
			shareCode: 'ABC12345',
			announcements: [{ id: 'a1', content: 'Milch kaufen', createdAt: '2026-05-18' }],
			chores: [],
			expenses: [{ id: 'e1', description: 'Milch', amountCents: 199, occurredAt: '2026-05-18' }],
			recurringExpenses: [
				{
					id: 'r1',
					description: 'Milch-Abo',
					amountCents: 899,
					intervalMonths: 1,
					nextDueAt: '2026-05-18',
				},
			],
			shoppingItems: [{ id: 's1', name: 'Milch', quantity: null, boughtAt: null }],
			absences: [
				{
					id: 'ab1',
					memberId: 'm2',
					memberName: 'Milena',
					startDate: '2026-05-18T00:00:00.000Z',
					endDate: '2026-05-20T23:59:59.000Z',
					reason: 'Urlaub',
				},
			],
		});

		expect(groupSearchResults(results).map((group) => [group.module, group.count])).toEqual([
			['pinnwand', 1],
			['ausgaben', 1],
			['fixkosten', 1],
			['einkauf', 1],
		]);
	});

	it('returns no results for empty queries', () => {
		expect(
			searchWgItems('  ', {
				shareCode: 'ABC12345',
				announcements: [{ id: 'a1', content: 'Milch', createdAt: '2026-05-18' }],
				chores: [],
				expenses: [],
				recurringExpenses: [],
				shoppingItems: [],
				absences: [],
			}),
		).toEqual([]);
	});

	it('filters results by selected modules', () => {
		const results = searchWgItems('milch', {
			shareCode: 'ABC12345',
			announcements: [{ id: 'a1', content: 'Milch kaufen', createdAt: '2026-05-18' }],
			chores: [],
			expenses: [{ id: 'e1', description: 'Milch', amountCents: 199, occurredAt: '2026-05-18' }],
			recurringExpenses: [],
			shoppingItems: [{ id: 's1', name: 'Milch', quantity: null, boughtAt: null }],
			absences: [],
		});

		expect(filterSearchResults(results, ['ausgaben']).map((result) => result.module)).toEqual([
			'ausgaben',
		]);
		expect(filterSearchResults(results, []).map((result) => result.module)).toEqual([
			'pinnwand',
			'ausgaben',
			'einkauf',
		]);
	});

	it('builds safe highlight segments for the matching text', () => {
		expect(highlightSearchMatch('Hafermilch und Brot', 'milch')).toEqual([
			{ text: 'Hafer', match: false },
			{ text: 'milch', match: true },
			{ text: ' und Brot', match: false },
		]);
	});

	it('finds member absences from name or reason', () => {
		const results = searchWgItems('urlaub', {
			shareCode: 'ABC12345',
			currentMemberId: 'm1',
			announcements: [],
			chores: [],
			expenses: [],
			recurringExpenses: [],
			shoppingItems: [],
			absences: [
				{
					id: 'ab1',
					memberId: 'm1',
					memberName: 'Ava',
					startDate: '2099-05-18T12:00:00.000Z',
					endDate: '2099-05-20T12:00:00.000Z',
					reason: 'Urlaub',
				},
			],
		});

		expect(results).toMatchObject([
			{
				id: 'ab1',
				module: 'abwesenheiten',
				title: 'Ava ist abwesend',
				meta: '18.05. bis 20.05. · Urlaub',
				href: '/wg/ABC12345/putzen?panel=absences&absence=ab1',
				tags: expect.arrayContaining(['open', 'mine']),
			},
		]);
	});

	it('keeps ended absences searchable without the open tag', () => {
		const results = searchWgItems('urlaub', {
			shareCode: 'ABC12345',
			currentMemberId: 'm1',
			announcements: [],
			chores: [],
			expenses: [],
			recurringExpenses: [],
			shoppingItems: [],
			absences: [
				{
					id: 'ab-ended',
					memberId: 'm1',
					memberName: 'Ava',
					startDate: '2026-01-10T00:00:00.000Z',
					endDate: '2026-01-12T23:59:59.000Z',
					reason: 'Urlaub',
				},
			],
		});

		expect(results).toMatchObject([
			{
				id: 'ab-ended',
				module: 'abwesenheiten',
				tags: ['mine'],
			},
		]);
		expect(results[0]?.tags).not.toContain('open');
	});

	it('keeps absence search results readable when stored dates are invalid', () => {
		const results = searchWgItems('urlaub', {
			shareCode: 'ABC12345',
			announcements: [],
			chores: [],
			expenses: [],
			recurringExpenses: [],
			shoppingItems: [],
			absences: [
				{
					id: 'ab1',
					memberId: 'm1',
					memberName: 'Ava',
					startDate: 'broken',
					endDate: '2026-05-20T12:00:00.000Z',
					reason: 'Urlaub',
				},
			],
		});

		expect(results[0]?.meta).toBe('Datum unbekannt bis 20.05. · Urlaub');
	});

	it('suggests useful searches from current WG content when query is empty', () => {
		const suggestions = getSearchSuggestions({
			openShoppingTop: ['Milch (2x)', 'Klopapier'],
			dueChoreTitles: ['Bad putzen'],
			dueRecurringDescriptions: ['Internet'],
			latestAnnouncementContent: 'Bitte leise sein ab 22 Uhr',
		});

		expect(suggestions).toEqual([
			'Milch',
			'Klopapier',
			'Bad putzen',
			'Internet',
			'Bitte leise sein',
		]);
	});
});
