import { describe, expect, it } from 'vitest';
import {
	getEmptyWgActions,
	getTodayFocus,
	getTodayImportantItems,
	getTodayListItems,
	getWgHealth,
} from './dashboard-insights';

describe('getTodayImportantItems', () => {
	it('prioritizes overdue chores, open shopping, personal tasks, and debt', () => {
		const items = getTodayImportantItems({
			shareCode: 'ABC12345',
			myBalanceCents: -1250,
			openShoppingTop: ['Milch (2x)', 'Kaffee'],
			dueChores: [
				{
					id: 'c1',
					title: 'Bad putzen',
					nextDueAt: '2026-05-16T12:00:00.000Z',
					overdue: true,
				},
			],
			myOpenAnnouncements: [{ id: 'a1', kind: 'task', content: 'Router neu starten' }],
			absentMembers: [
				{
					id: 'ab1',
					memberId: 'm2',
					name: 'Nava',
					endDate: '2026-05-20T00:00:00.000Z',
					isCurrentMember: false,
				},
			],
			now: new Date('2026-05-18T12:00:00.000Z').getTime(),
		});

		expect(items.map((item) => [item.kind, item.title, item.href])).toEqual([
			['chore', 'Bad putzen', '/wg/ABC12345/putzen?highlight=c1'],
			['shopping', 'Milch (2x) fehlt noch', '/wg/ABC12345/einkauf'],
			['announcement', 'Router neu starten', '/wg/ABC12345/pinnwand#announcement-a1'],
			['absence', 'Nava ist abwesend', '/wg/ABC12345/putzen?panel=absences&absence=ab1'],
			['debt', 'Du schuldest noch 12,50 €', '/wg/ABC12345/ausgaben'],
		]);
		expect(items.find((item) => item.kind === 'absence')?.detail).toBe('bis 20.05.');
	});

	it('keeps absence insight dates readable when stored dates are invalid', () => {
		const items = getTodayImportantItems({
			shareCode: 'ABC12345',
			myBalanceCents: 0,
			openShoppingTop: [],
			dueChores: [],
			myOpenAnnouncements: [],
			absentMembers: [
				{
					id: 'ab1',
					memberId: 'm2',
					name: 'Nava',
					endDate: 'broken',
					isCurrentMember: false,
				},
			],
		});

		expect(items[0]?.detail).toBe('bis Datum unbekannt');
	});

	it('keeps chore due labels readable when stored dates are invalid', () => {
		const items = getTodayImportantItems({
			shareCode: 'ABC12345',
			myBalanceCents: 0,
			openShoppingTop: [],
			dueChores: [
				{
					id: 'c1',
					title: 'Bad putzen',
					nextDueAt: 'broken',
					overdue: false,
				},
			],
			myOpenAnnouncements: [],
		});

		expect(items[0]).toMatchObject({
			kind: 'chore',
			title: 'Bad putzen',
			detail: 'Datum prüfen',
		});
	});

	it('encodes entity ids in today-important links', () => {
		const items = getTodayImportantItems({
			shareCode: 'WG/123?x=1',
			myBalanceCents: 0,
			openShoppingTop: [],
			dueChores: [
				{
					id: 'chore 1&tab=all',
					title: 'Bad putzen',
					nextDueAt: '2026-05-18T12:00:00.000Z',
					overdue: false,
				},
			],
			myOpenAnnouncements: [
				{ id: 'pin/1?focus=comments', kind: 'task', content: 'Router neu starten' },
			],
			dueRecurringExpenses: [
				{ id: 'recurring 1&edit=true', description: 'Internet', amountCents: 3290 },
			],
			absentMembers: [
				{
					id: 'absence 1&panel=bad',
					memberId: 'm1',
					name: 'Ava',
					endDate: '2026-05-20T00:00:00.000Z',
					isCurrentMember: true,
				},
			],
			now: new Date('2026-05-18T12:00:00.000Z').getTime(),
		});

		expect(items.map((item) => [item.kind, item.href])).toEqual([
			['chore', '/wg/WG%2F123%3Fx%3D1/putzen?highlight=chore%201%26tab%3Dall'],
			['announcement', '/wg/WG%2F123%3Fx%3D1/pinnwand#announcement-pin%2F1%3Ffocus%3Dcomments'],
			['recurring', '/wg/WG%2F123%3Fx%3D1/ausgaben?recurring=recurring%201%26edit%3Dtrue'],
			['absence', '/wg/WG%2F123%3Fx%3D1/putzen?panel=absences&absence=absence%201%26panel%3Dbad'],
		]);
	});

	it('returns a calm state when nothing needs attention', () => {
		expect(
			getTodayImportantItems({
				shareCode: 'ABC12345',
				myBalanceCents: 0,
				openShoppingTop: [],
				dueChores: [],
				myOpenAnnouncements: [],
				now: new Date('2026-05-18T12:00:00.000Z').getTime(),
			}),
		).toEqual([]);
	});

	it('picks one clear next action for the top of the dashboard', () => {
		const focus = getTodayFocus([
			{
				kind: 'shopping',
				title: 'Milch fehlt noch',
				detail: '1 offener Artikel',
				href: '/wg/ABC12345/einkauf',
				tone: 'neutral',
			},
			{
				kind: 'debt',
				title: 'Du schuldest noch 12,50 €',
				detail: 'Ausgaben ausgleichen',
				href: '/wg/ABC12345/ausgaben',
				tone: 'danger',
			},
		]);

		expect(focus?.title).toBe('Du schuldest noch 12,50 €');
		expect(focus?.actionLabel).toBe('Jetzt klären');
	});

	it('keeps the dashboard focus item out of the repeated today list', () => {
		const items = getTodayImportantItems({
			shareCode: 'ABC12345',
			myBalanceCents: -1250,
			openShoppingTop: ['Milch'],
			dueChores: [],
			myOpenAnnouncements: [],
			now: new Date('2026-05-18T12:00:00.000Z').getTime(),
		});
		const focus = getTodayFocus(items);

		expect(focus?.title).toBe('Du schuldest noch 12,50 €');
		expect(getTodayListItems(items, focus).map((item) => item.title)).toEqual(['Milch fehlt noch']);
	});
});

describe('getWgHealth', () => {
	it('turns WG friction into a scannable health score', () => {
		const health = getWgHealth({
			shareCode: 'WG/123?x=1',
			openShoppingCount: 2,
			overdueChoreCount: 1,
			openDebtCents: 5000,
			openAnnouncementCount: 1,
			absentMemberCount: 1,
			dueRecurringCount: 1,
		});

		expect(health.score).toBeLessThan(80);
		expect(health.items.map((item) => item.label)).toContain('Putzlücken');
		expect(health.items.find((item) => item.label === 'Fixkosten fällig')?.href).toBe(
			'/wg/WG%2F123%3Fx%3D1/ausgaben?filter=recurring',
		);
	});
});

describe('getEmptyWgActions', () => {
	it('guides a new WG toward the next useful setup actions', () => {
		expect(
			getEmptyWgActions({
				shareCode: 'WG/123?x=1',
				memberCount: 1,
				choreCount: 0,
				hasExpense: false,
				hasShoppingItem: false,
				hasAnnouncement: false,
				notificationsEnabled: false,
			}).map((item) => [item.title, item.href]),
		).toEqual([
			['Mitbewohner einladen', '/wg/WG%2F123%3Fx%3D1/einstellungen'],
			['Putzplan starten', '/wg/WG%2F123%3Fx%3D1/putzen?title=Bad+putzen'],
			['Erste Ausgabe eintragen', '/wg/WG%2F123%3Fx%3D1/ausgaben?desc=Internet&amount=32%2C90'],
			['Einkaufsliste füllen', '/wg/WG%2F123%3Fx%3D1/einkauf?name=Milch'],
			[
				'Ersten Pinnwand-Beitrag schreiben',
				'/wg/WG%2F123%3Fx%3D1/pinnwand?content=Paket+im+Flur&kind=question',
			],
		]);
	});

	it('uses polished German copy for notification setup', () => {
		expect(
			getEmptyWgActions({
				shareCode: 'ABC12345',
				memberCount: 2,
				choreCount: 1,
				hasExpense: true,
				hasShoppingItem: true,
				hasAnnouncement: true,
				notificationsEnabled: false,
			}).map((item) => [item.title, item.href]),
		).toEqual([['Benachrichtigungen prüfen', '/wg/ABC12345/einstellungen#benachrichtigungen']]);
	});
});
