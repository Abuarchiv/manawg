import { describe, expect, it } from 'vitest';
import {
	buildDueChores,
	computeMemberBalances,
	countOpenManualAnnouncements,
	getCurrentAbsenceRowsByMember,
	getLatestManualAnnouncement,
	isDuplicateAuditActivity,
} from './dashboard-data';
import {
	getDashboardActivityHref,
	getDashboardAnnouncementHref,
	getDashboardAuditHref,
	getDashboardAuditKind,
	getDashboardEmptyActionHref,
} from './dashboard-links';

describe('getDashboardActivityHref', () => {
	it('builds WG-scoped links for dashboard activity rows', () => {
		expect(getDashboardActivityHref('MTE8PZAT', 'expense', 'expense-1')).toBe(
			'/wg/MTE8PZAT/ausgaben?highlight=expense-1',
		);
		expect(getDashboardActivityHref('MTE8PZAT', 'shopping', 'shopping-1')).toBe(
			'/wg/MTE8PZAT/einkauf?highlight=shopping-1',
		);
		expect(getDashboardActivityHref('MTE8PZAT', 'announcement', 'announcement-1')).toBe(
			'/wg/MTE8PZAT/pinnwand#announcement-announcement-1',
		);
		expect(getDashboardActivityHref('MTE8PZAT', 'chore', 'absence-1')).toBe(
			'/wg/MTE8PZAT/putzen?highlight=absence-1',
		);
		expect(getDashboardActivityHref('MTE8PZAT', 'recurring', 'recurring-1')).toBe(
			'/wg/MTE8PZAT/ausgaben?recurring=recurring-1',
		);
		expect(getDashboardActivityHref('MTE8PZAT', 'absence', 'absence-1')).toBe(
			'/wg/MTE8PZAT/putzen?panel=absences&absence=absence-1',
		);
	});

	it('encodes dashboard activity ids in query and hash links', () => {
		expect(getDashboardActivityHref('WG/123?x=1', 'shopping', 'shopping-1')).toBe(
			'/wg/WG%2F123%3Fx%3D1/einkauf?highlight=shopping-1',
		);
		expect(getDashboardActivityHref('MTE8PZAT', 'shopping', 'shopping 1&open=true')).toBe(
			'/wg/MTE8PZAT/einkauf?highlight=shopping%201%26open%3Dtrue',
		);
		expect(getDashboardActivityHref('MTE8PZAT', 'announcement', 'pin/1?focus=comments')).toBe(
			'/wg/MTE8PZAT/pinnwand#announcement-pin%2F1%3Ffocus%3Dcomments',
		);
	});

	it('builds encoded WG-scoped announcement links for dashboard widgets', () => {
		expect(getDashboardAnnouncementHref('MTE8PZAT', 'pin/1?focus=comments')).toBe(
			'/wg/MTE8PZAT/pinnwand#announcement-pin%2F1%3Ffocus%3Dcomments',
		);
	});

	it('builds WG-scoped links for audit rows with linked entities', () => {
		expect(
			getDashboardAuditHref('WG/123?x=1', {
				eventType: 'expense.created',
				entityType: 'expense',
				entityId: 'expense-1',
			}),
		).toBe('/wg/WG%2F123%3Fx%3D1/ausgaben?highlight=expense-1');

		expect(
			getDashboardAuditHref('MTE8PZAT', {
				eventType: 'expense.created',
				entityType: 'expense',
				entityId: 'expense-1',
			}),
		).toBe('/wg/MTE8PZAT/ausgaben?highlight=expense-1');

		expect(
			getDashboardAuditHref('MTE8PZAT', {
				eventType: 'recurring.deleted',
				entityType: 'recurring_expense',
				entityId: 'recurring-1',
			}),
		).toBe('/wg/MTE8PZAT/ausgaben?filter=recurring');

		expect(
			getDashboardAuditHref('MTE8PZAT', {
				eventType: 'shopping.created',
				entityType: 'shopping_item',
				entityId: 'shopping 1&open=true',
			}),
		).toBe('/wg/MTE8PZAT/einkauf?highlight=shopping%201%26open%3Dtrue');
	});

	it('maps audit rows to the dashboard kind of their affected area', () => {
		expect(
			getDashboardAuditKind({ eventType: 'shopping.created', entityType: 'shopping_item' }),
		).toBe('shopping');
		expect(
			getDashboardAuditKind({ eventType: 'announcement.updated', entityType: 'announcement' }),
		).toBe('announcement');
		expect(
			getDashboardAuditKind({ eventType: 'absence.created', entityType: 'member_absence' }),
		).toBe('absence');
		expect(
			getDashboardAuditKind({
				eventType: 'recurring.deleted',
				entityType: 'recurring_expense',
			}),
		).toBe('recurring');
		expect(getDashboardAuditKind({ eventType: 'wg.created', entityType: 'wg' })).toBe('audit');
		expect(getDashboardAuditKind({ eventType: 'notification.updated', entityType: 'member' })).toBe(
			'audit',
		);
	});

	it('builds encoded prefill links for dashboard empty-state actions', () => {
		expect(
			getDashboardEmptyActionHref('MTE8PZAT', 'expense', {
				desc: 'Wocheneinkauf & Snacks',
				amount: '25,00',
			}),
		).toBe('/wg/MTE8PZAT/ausgaben?desc=Wocheneinkauf+%26+Snacks&amount=25%2C00');

		expect(
			getDashboardEmptyActionHref('MTE8PZAT', 'announcement', {
				kind: 'info',
				content: 'Hallo zusammen!',
			}),
		).toBe('/wg/MTE8PZAT/pinnwand?kind=info&content=Hallo+zusammen%21');
	});

	it('uses only manual announcements for the latest announcement widget', () => {
		const members = new Map([['member-1', { name: 'Ava' }]]);

		expect(
			getLatestManualAnnouncement(
				[
					{
						content: 'System Sync',
						authorMemberId: 'system',
						source: 'system',
						createdAt: new Date('2026-05-25T12:00:00.000Z'),
					},
					{
						content: 'Bitte leise sein ab 22 Uhr',
						authorMemberId: 'member-1',
						source: 'manual',
						createdAt: new Date('2026-05-25T10:00:00.000Z'),
					},
				],
				members,
			),
		).toEqual({
			content: 'Bitte leise sein ab 22 Uhr',
			authorName: 'Ava',
			createdAt: '2026-05-25T10:00:00.000Z',
		});

		expect(
			getLatestManualAnnouncement(
				[
					{
						content: 'System Sync',
						authorMemberId: 'system',
						source: 'system',
						createdAt: new Date('2026-05-25T12:00:00.000Z'),
					},
				],
				members,
			),
		).toBeNull();
	});
});

describe('dashboard data helpers', () => {
	it('counts all open manual announcements rather than the rendered preview slice', () => {
		const rows = Array.from({ length: 7 }, (_, index) => ({
			source: 'manual',
			status: index === 6 ? 'resolved' : 'open',
		}));

		expect(countOpenManualAnnouncements(rows)).toBe(6);
	});

	it('uses the newest active absence row when duplicate active rows exist for a member', () => {
		const now = new Date('2026-05-25T12:00:00.000Z').getTime();
		const currentByMember = getCurrentAbsenceRowsByMember(
			[
				{
					id: 'past',
					memberId: 'member-1',
					startDate: new Date('2026-05-01T00:00:00.000Z'),
					endDate: new Date('2026-05-02T00:00:00.000Z'),
				},
				{
					id: 'older-active',
					memberId: 'member-1',
					startDate: new Date('2026-05-20T00:00:00.000Z'),
					endDate: new Date('2026-05-28T00:00:00.000Z'),
				},
				{
					id: 'newer-active',
					memberId: 'member-1',
					startDate: new Date('2026-05-24T00:00:00.000Z'),
					endDate: new Date('2026-05-26T00:00:00.000Z'),
				},
			],
			now,
		);

		expect(currentByMember.get('member-1')?.id).toBe('newer-active');
	});

	it('keeps balances summing to zero when an expense was paid by a departed member', () => {
		const balances = computeMemberBalances(
			[
				{ id: 'active', name: 'Ava', color: null },
				{ id: 'gone', name: 'Ben', color: null },
			],
			[{ paidByMemberId: 'gone', amountCents: 5000 }],
			[
				{ debtorMemberId: 'active', amountCents: 2500, settledAt: null },
				{ debtorMemberId: 'gone', amountCents: 2500, settledAt: null },
			],
		);

		expect(balances.find((b) => b.memberId === 'gone')?.paidCents).toBe(5000);
		expect(balances.reduce((sum, b) => sum + b.balanceCents, 0)).toBe(0);
	});

	it('counts overdue chores beyond the four rendered on the dashboard card', () => {
		const memberById = new Map([['member-1', { name: 'Ava', color: null }]]);
		const now = new Date('2026-05-25T12:00:00.000Z');
		const choreRows = Array.from({ length: 6 }, (_, index) => ({
			id: `chore-${index}`,
			title: `Chore ${index}`,
			nextDueAt: new Date(Date.UTC(2026, 4, 20 + index, 10)),
			assignedMemberId: 'member-1',
		}));

		const allDueChores = buildDueChores(choreRows, memberById, now);
		const dueChores = allDueChores.slice(0, 4);

		expect(allDueChores.filter((c) => c.overdue)).toHaveLength(6);
		expect(dueChores.filter((c) => c.overdue)).toHaveLength(4);
	});

	it('suppresses audit entries duplicating a raw card entry for the same entity', () => {
		const rawByKey = new Map([['expense:expense-1', Date.parse('2026-05-25T10:00:00.000Z')]]);

		expect(
			isDuplicateAuditActivity(
				rawByKey,
				'expense',
				'expense-1',
				Date.parse('2026-05-25T10:00:30.000Z'),
			),
		).toBe(true);
		expect(
			isDuplicateAuditActivity(
				rawByKey,
				'expense',
				'expense-1',
				Date.parse('2026-05-25T11:00:00.000Z'),
			),
		).toBe(false);
		expect(
			isDuplicateAuditActivity(
				rawByKey,
				'expense',
				'expense-2',
				Date.parse('2026-05-25T10:00:00.000Z'),
			),
		).toBe(false);
		expect(
			isDuplicateAuditActivity(rawByKey, 'expense', null, Date.parse('2026-05-25T10:00:00.000Z')),
		).toBe(false);
	});
});
