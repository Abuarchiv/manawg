// In-memory WGs, dashboard and chat for the database-free Playwright build.
import type { DashboardData } from '@/composition/dashboard-data';
import type { wgChatMessages } from '@/core/db';

export const E2E_EXISTING_WG = {
	id: '989ac820-58b7-431f-9c65-28721264f333',
	shareCode: 'MTE8PZAT',
	name: 'sadf',
	member: {
		id: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
		name: 'dsaf',
		color: '#6d5efc',
	},
} as const;

export const E2E_CREATED_WG = {
	id: 'f3cfbb01-844c-4ba6-9ea7-0ee8d68b0d83',
	shareCode: 'SMKETEST',
	member: {
		id: 'a2c3f1b7-2fd9-476b-9e25-a1c8c0115db1',
		color: '#0ea5e9',
	},
} as const;

/** 22-character fixture invitations: the first joins `E2E_EXISTING_WG`, the second has expired. */
export const E2E_INVITE_TOKEN = 'fixture-invite-token01';
export const E2E_EXPIRED_INVITE_TOKEN = 'expired-invite-token-1';

export interface E2EWgFixture {
	id: string;
	name: string;
	shareCode: string;
	members: Array<{ id: string; name: string; color: string | null }>;
}

export function getE2EWgFixture(code: string): E2EWgFixture | null {
	if (code === E2E_EXISTING_WG.shareCode) {
		return {
			id: E2E_EXISTING_WG.id,
			name: E2E_EXISTING_WG.name,
			shareCode: E2E_EXISTING_WG.shareCode,
			members: [
				E2E_EXISTING_WG.member,
				{ id: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55', name: 'Mina', color: '#0f766e' },
			],
		};
	}

	if (code === E2E_CREATED_WG.shareCode) {
		return {
			id: E2E_CREATED_WG.id,
			name: 'Smoke Test WG',
			shareCode: E2E_CREATED_WG.shareCode,
			members: [{ ...E2E_CREATED_WG.member, name: 'Smoke Tester' }],
		};
	}

	return null;
}

export function buildE2EDashboardData(code: string): DashboardData {
	const now = Date.now();
	const day = 86_400_000;

	return {
		balances: [
			{
				memberId:
					code === E2E_CREATED_WG.shareCode ? E2E_CREATED_WG.member.id : E2E_EXISTING_WG.member.id,
				memberName:
					code === E2E_CREATED_WG.shareCode ? 'Smoke Tester' : E2E_EXISTING_WG.member.name,
				color:
					code === E2E_CREATED_WG.shareCode
						? E2E_CREATED_WG.member.color
						: E2E_EXISTING_WG.member.color,
				currency: 'EUR',
				paidCents: 3290,
				owedCents: 0,
				balanceCents: 3290,
			},
		],
		spendByDay: Array.from({ length: 14 }, (_, idx) => ({
			date: new Date(now - (13 - idx) * day).toISOString().slice(0, 10),
			currency: 'EUR',
			cents: idx === 13 ? 3290 : 0,
		})),
		totalSpendByCurrency: { EUR: 3290 },
		weekSpendByCurrency: { EUR: 3290 },
		monthSpendByCurrency: { EUR: 3290 },
		totalSpendCents: 3290,
		weekSpendCents: 3290,
		monthSpendCents: 3290,
		openShoppingCount: 1,
		openShoppingTop: ['Hafermilch'],
		dueChores: [
			{
				id: 'dc02a93f-59f6-4cf9-80a7-53d4a407cb49',
				title: 'Bad putzen',
				assignedMemberId:
					code === E2E_CREATED_WG.shareCode ? E2E_CREATED_WG.member.id : E2E_EXISTING_WG.member.id,
				assignedMemberName:
					code === E2E_CREATED_WG.shareCode ? 'Smoke Tester' : E2E_EXISTING_WG.member.name,
				assignedColor:
					code === E2E_CREATED_WG.shareCode
						? E2E_CREATED_WG.member.color
						: E2E_EXISTING_WG.member.color,
				nextDueAt: new Date(now + day).toISOString(),
				overdue: false,
			},
		],
		activity: [
			{
				kind: 'expense',
				timestamp: new Date(now).toISOString(),
				memberId:
					code === E2E_CREATED_WG.shareCode ? E2E_CREATED_WG.member.id : E2E_EXISTING_WG.member.id,
				memberName:
					code === E2E_CREATED_WG.shareCode ? 'Smoke Tester' : E2E_EXISTING_WG.member.name,
				text: 'Internet',
				amountCents: 3290,
			},
		],
		latestAnnouncement: null,
		myOpenAnnouncements: [],
		dueRecurringExpenses: [
			{
				id: 'a1ef32d5-d40a-4df2-9977-7684dce7df3f',
				description: 'Internet',
				amountCents: 3290,
				currency: 'EUR',
				nextDueAt: new Date(now - day).toISOString(),
			},
		],
		absentMembers: [],
		setup: {
			choreCount: 1,
			hasExpense: true,
			hasShoppingItem: true,
			hasAnnouncement: false,
			notificationsEnabled: true,
		},
	};
}

type ChatMessageRow = typeof wgChatMessages.$inferSelect;

export function buildE2EChatMessages(wgId: string): ChatMessageRow[] {
	const now = Date.now();
	return [
		{
			id: '1c2c9254-5945-4774-9f03-d12e772d3a6f',
			wgId,
			senderMemberId: '0ab8c8f2-5d03-4a84-aadc-4c5d7e8abf55',
			kind: 'text',
			body: 'Das ist eine ziemlich lange Chat-Nachricht mit einem_sehr_langen_ununterbrochenen_Wort_das_trotzdem_nicht_die_mobile_Ansicht_sprengen_darf.',
			imageUrl: null,
			replyToMessageId: null,
			systemKind: null,
			systemPayload: null,
			createdAt: new Date(now - 120_000),
			editedAt: null,
			deletedAt: null,
		},
		{
			id: '8c1bb4a9-4722-42fe-bb86-aebf2e2d5b11',
			wgId,
			senderMemberId: '7d898f9e-5ad7-4f5d-abed-8c3e99a76973',
			kind: 'text',
			body: 'Alles klar, ich bringe Hafermilch mit.',
			imageUrl: null,
			replyToMessageId: '1c2c9254-5945-4774-9f03-d12e772d3a6f',
			systemKind: null,
			systemPayload: null,
			createdAt: new Date(now - 60_000),
			editedAt: null,
			deletedAt: null,
		},
	] as ChatMessageRow[];
}
