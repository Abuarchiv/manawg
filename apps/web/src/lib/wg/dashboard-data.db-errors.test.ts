import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
	query: {
		wgMembers: { findFirst: vi.fn() },
	},
	select: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
	announcementReactions: {
		announcementId: 'announcementReactions.announcementId',
		memberId: 'announcementReactions.memberId',
		reaction: 'announcementReactions.reaction',
	},
	announcements: {
		authorMemberId: 'announcements.authorMemberId',
		content: 'announcements.content',
		createdAt: 'announcements.createdAt',
		id: 'announcements.id',
		kind: 'announcements.kind',
		source: 'announcements.source',
		status: 'announcements.status',
		wgId: 'announcements.wgId',
	},
	auditEvents: {
		createdAt: 'auditEvents.createdAt',
		entityId: 'auditEvents.entityId',
		entityType: 'auditEvents.entityType',
		eventType: 'auditEvents.eventType',
		id: 'auditEvents.id',
		memberId: 'auditEvents.memberId',
		metadataJson: 'auditEvents.metadataJson',
		summary: 'auditEvents.summary',
		wgId: 'auditEvents.wgId',
	},
	chores: {
		assignedMemberId: 'chores.assignedMemberId',
		id: 'chores.id',
		nextDueAt: 'chores.nextDueAt',
		title: 'chores.title',
		wgId: 'chores.wgId',
	},
	db: {
		query: dbMock.query,
		select: (...args: unknown[]) => dbMock.select(...args),
	},
	expenseSplits: {
		amountCents: 'expenseSplits.amountCents',
		debtorMemberId: 'expenseSplits.debtorMemberId',
		expenseId: 'expenseSplits.expenseId',
		settledAt: 'expenseSplits.settledAt',
	},
	expenses: {
		amountCents: 'expenses.amountCents',
		description: 'expenses.description',
		id: 'expenses.id',
		occurredAt: 'expenses.occurredAt',
		paidByMemberId: 'expenses.paidByMemberId',
		wgId: 'expenses.wgId',
	},
	memberAbsences: {
		endDate: 'memberAbsences.endDate',
		id: 'memberAbsences.id',
		memberId: 'memberAbsences.memberId',
		startDate: 'memberAbsences.startDate',
		wgId: 'memberAbsences.wgId',
	},
	recurringExpenses: {
		amountCents: 'recurringExpenses.amountCents',
		createdAt: 'recurringExpenses.createdAt',
		description: 'recurringExpenses.description',
		id: 'recurringExpenses.id',
		lastCreatedAt: 'recurringExpenses.lastCreatedAt',
		nextDueAt: 'recurringExpenses.nextDueAt',
		wgId: 'recurringExpenses.wgId',
	},
	shoppingItems: {
		addedByMemberId: 'shoppingItems.addedByMemberId',
		boughtAt: 'shoppingItems.boughtAt',
		createdAt: 'shoppingItems.createdAt',
		id: 'shoppingItems.id',
		name: 'shoppingItems.name',
		quantity: 'shoppingItems.quantity',
		wgId: 'shoppingItems.wgId',
	},
	wgMembers: {
		color: 'wgMembers.color',
		id: 'wgMembers.id',
		name: 'wgMembers.name',
		wgId: 'wgMembers.wgId',
	},
}));

vi.mock('drizzle-orm', () => ({
	and: (...args: unknown[]) => ({ and: args }),
	desc: (value: unknown) => value,
	eq: (...args: unknown[]) => ({ eq: args }),
}));

type ChainPromise = Promise<unknown[]> & {
	from: (...args: unknown[]) => ChainPromise;
	innerJoin: (...args: unknown[]) => ChainPromise;
	where: (...args: unknown[]) => ChainPromise;
	orderBy: (...args: unknown[]) => ChainPromise;
	limit: (...args: unknown[]) => ChainPromise;
};

function selectRows(rows: unknown[]): ChainPromise {
	const promise = Promise.resolve(rows) as ChainPromise;
	const noop = () => promise;
	promise.from = noop;
	promise.innerJoin = noop;
	promise.where = noop;
	promise.orderBy = noop;
	promise.limit = noop;
	return promise;
}

function selectError(error: Error): ChainPromise {
	const promise = Promise.reject(error) as ChainPromise;
	const noop = () => promise;
	promise.from = noop;
	promise.innerJoin = noop;
	promise.where = noop;
	promise.orderBy = noop;
	promise.limit = noop;
	return promise;
}

describe('loadDashboardData DB errors', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('RED BUG-271-DASHBOARD: fails instead of hiding absence section load errors', async () => {
		const { loadDashboardData } = await import('./dashboard-data');
		dbMock.select
			.mockReturnValueOnce(selectRows([{ id: 'member-1', name: 'Ava', color: null }]))
			.mockReturnValueOnce(selectRows([]))
			.mockReturnValueOnce(selectRows([]))
			.mockReturnValueOnce(selectRows([]))
			.mockReturnValueOnce(selectRows([]))
			.mockReturnValueOnce(selectRows([]))
			.mockReturnValueOnce(selectError(new Error('absence table unavailable')))
			.mockReturnValueOnce(selectRows([]))
			.mockReturnValueOnce(selectRows([]));

		await expect(loadDashboardData('wg-1', null, 'MTE8PZAT')).rejects.toThrow(
			'absence table unavailable',
		);
	});
});
