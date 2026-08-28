import { describe, expect, it } from 'vitest';
import {
	buildActivityInbox,
	buildActivityTimeline,
	filterActivityByScope,
	filterActivityItems,
	formatAuditActivityText,
	getActivityEmptyActionHref,
	getActivityReminders,
	groupActivityItemsByDay,
} from './activity';

const NOW = new Date('2026-05-18T12:00:00.000Z').getTime();

describe('getActivityEmptyActionHref', () => {
	it('builds encoded prefill links for the activity empty state', () => {
		expect(
			getActivityEmptyActionHref('WG/123?x=1', 'expense', {
				desc: 'Internet',
			}),
		).toBe('/wg/WG%2F123%3Fx%3D1/ausgaben?desc=Internet');
		expect(
			getActivityEmptyActionHref('MTE8PZAT', 'expense', {
				desc: 'Internet & Streaming',
				amount: '32,90',
			}),
		).toBe('/wg/MTE8PZAT/ausgaben?desc=Internet+%26+Streaming&amount=32%2C90');
		expect(
			getActivityEmptyActionHref('MTE8PZAT', 'announcement', {
				content: 'Paket im Flur',
				kind: 'question',
			}),
		).toBe('/wg/MTE8PZAT/pinnwand?content=Paket+im+Flur&kind=question');
		expect(
			getActivityEmptyActionHref('MTE8PZAT', 'chore', {
				title: 'Bad putzen',
			}),
		).toBe('/wg/MTE8PZAT/putzen?title=Bad+putzen');
	});
});

describe('buildActivityTimeline', () => {
	it('combines WG events into one newest-first timeline', () => {
		const items = buildActivityTimeline({
			members: [
				{ id: 'm1', name: 'Ava' },
				{ id: 'm2', name: 'Ben' },
			],
			expenses: [
				{
					id: 'e1',
					paidByMemberId: 'm1',
					description: 'Miete',
					amountCents: 50000,
					occurredAt: '2026-05-18T08:00:00.000Z',
				},
			],
			shoppingItems: [
				{
					id: 's1',
					addedByMemberId: 'm2',
					name: 'Milch',
					createdAt: '2026-05-17T08:00:00.000Z',
					boughtAt: null,
				},
			],
			announcements: [
				{
					id: 'a1',
					authorMemberId: 'm1',
					content: 'Bitte leise',
					createdAt: '2026-05-18T10:00:00.000Z',
					source: 'manual',
				},
			],
			choreCompletions: [
				{
					id: 'cc1',
					choreId: 'c1',
					choreTitle: 'Bad',
					completedByMemberId: 'm2',
					completedAt: '2026-05-18T11:00:00.000Z',
				},
			],
			recurringExpenses: [
				{
					id: 'r1',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					createdAt: '2026-05-18T09:00:00.000Z',
					lastCreatedAt: null,
				},
			],
			absences: [
				{
					id: 'ab1',
					memberId: 'm2',
					startDate: '2026-05-20T00:00:00.000Z',
					endDate: '2026-05-22T21:59:59.000Z',
					reason: 'Urlaub',
					createdAt: '2026-05-18T09:30:00.000Z',
				},
			],
			auditEvents: [
				{
					id: 'au1',
					memberId: 'm1',
					eventType: 'expense.updated',
					summary: 'Ava hat Miete aktualisiert.',
					metadataJson: JSON.stringify({ amountCents: 50000, splitCount: 2 }),
					createdAt: '2026-05-18T11:30:00.000Z',
				},
			],
			limit: 10,
		});

		expect(items.map((item) => [item.kind, item.memberName, item.text])).toEqual([
			['audit', 'Ava', 'hat Miete aktualisiert.'],
			['chore', 'Ben', 'Bad erledigt'],
			['announcement', 'Ava', 'Bitte leise'],
			['absence', 'Ben', 'ist abwesend'],
			['recurring', 'Ava', 'Internet als Fixkosten-Vorlage angelegt'],
			['expense', 'Ava', 'Miete'],
			['shopping', 'Ben', 'Milch hinzugefügt'],
		]);
		expect(items[0]?.detail).toBe('500,00 € · 2 Aufteilungen');
		expect(items.find((item) => item.kind === 'absence')?.detail).toBe('20.05.-22.05. · Urlaub');
		expect(items.find((item) => item.kind === 'absence')?.href).toBe(
			'/putzen?panel=absences&absence=ab1',
		);
		expect(items.find((item) => item.kind === 'chore')?.href).toBe('/putzen?highlight=c1');
		expect(items.find((item) => item.kind === 'recurring')?.amountCents).toBe(3290);
	});

	it('encodes entity ids in direct timeline links', () => {
		const items = buildActivityTimeline({
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [
				{
					id: 'expense 1&open=true',
					paidByMemberId: 'm1',
					description: 'Miete',
					amountCents: 50000,
					occurredAt: '2026-05-18T08:00:00.000Z',
				},
			],
			shoppingItems: [
				{
					id: 'shopping 1&open=true',
					addedByMemberId: 'm1',
					name: 'Milch',
					createdAt: '2026-05-18T09:00:00.000Z',
					boughtAt: null,
				},
			],
			announcements: [
				{
					id: 'pin/1?focus=comments',
					authorMemberId: 'm1',
					content: 'Bitte leise',
					createdAt: '2026-05-18T10:00:00.000Z',
					source: 'manual',
				},
			],
			choreCompletions: [
				{
					id: 'cc1',
					choreId: 'chore 1&tab=all',
					choreTitle: 'Bad',
					completedByMemberId: 'm1',
					completedAt: '2026-05-18T11:00:00.000Z',
				},
			],
			recurringExpenses: [
				{
					id: 'recurring 1&edit=true',
					description: 'Internet',
					amountCents: 3290,
					paidByMemberId: 'm1',
					createdAt: '2026-05-18T07:00:00.000Z',
					lastCreatedAt: null,
				},
			],
			limit: 10,
		});

		expect(items.find((item) => item.kind === 'expense')?.href).toBe(
			'/ausgaben?highlight=expense%201%26open%3Dtrue',
		);
		expect(items.find((item) => item.kind === 'shopping')?.href).toBe(
			'/einkauf?highlight=shopping%201%26open%3Dtrue',
		);
		expect(items.find((item) => item.kind === 'announcement')?.href).toBe(
			'/pinnwand#announcement-pin%2F1%3Ffocus%3Dcomments',
		);
		expect(items.find((item) => item.kind === 'chore')?.href).toBe(
			'/putzen?highlight=chore%201%26tab%3Dall',
		);
		expect(items.find((item) => item.kind === 'recurring')?.href).toBe(
			'/ausgaben?recurring=recurring%201%26edit%3Dtrue',
		);
	});

	it('surfaces useful detail from newer audit metadata', () => {
		const items = buildActivityTimeline({
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [],
			shoppingItems: [],
			announcements: [],
			choreCompletions: [],
			auditEvents: [
				{
					id: 'a1',
					memberId: 'm1',
					eventType: 'wg.share_code_rotated',
					entityType: 'wg',
					entityId: 'wg-1',
					summary: 'Ava hat den WG-Code rotiert.',
					metadataJson: JSON.stringify({
						nameBefore: 'Alt-WG',
						nameAfter: 'ManaWG',
						joiningEnabledBefore: false,
						joiningEnabledAfter: true,
						shareCodeRotated: true,
					}),
					createdAt: '2026-05-18T12:00:00.000Z',
				},
				{
					id: 'a2',
					memberId: 'm1',
					eventType: 'announcement.comment.created',
					entityType: 'announcement_comment',
					entityId: 'comment-1',
					summary: 'Ava hat einen Kommentar geschrieben.',
					metadataJson: JSON.stringify({
						announcementId: 'announcement-1',
						contentPreview: 'Bin dabei',
						reaction: 'take',
					}),
					createdAt: '2026-05-18T11:00:00.000Z',
				},
				{
					id: 'a3',
					memberId: 'm1',
					eventType: 'recurring.created',
					entityType: 'recurring_expense',
					entityId: 'recurring-1',
					summary: 'Ava hat Internet als Fixkosten-Vorlage angelegt.',
					metadataJson: JSON.stringify({
						description: 'Internet',
						amountCents: 3290,
						intervalMonths: 1,
						nextDueAt: '2026-06-18T00:00:00.000Z',
						splitCount: 2,
					}),
					createdAt: '2026-05-18T10:00:00.000Z',
				},
				{
					id: 'a4',
					memberId: 'm1',
					eventType: 'absence.created',
					entityType: 'absence',
					entityId: 'absence-1',
					summary: 'Ava hat eine Abwesenheit eingetragen.',
					metadataJson: JSON.stringify({
						startDate: '2026-05-20T00:00:00.000Z',
						endDate: '2026-05-22T21:59:59.000Z',
						reason: 'Urlaub',
					}),
					createdAt: '2026-05-18T09:00:00.000Z',
				},
				{
					id: 'a5',
					memberId: 'm1',
					eventType: 'shopping.created',
					entityType: 'shopping_item',
					entityId: 'shopping-1',
					summary: 'Ava hat Milch auf die Einkaufsliste gesetzt.',
					metadataJson: JSON.stringify({ title: 'Milch', quantity: '2x' }),
					createdAt: '2026-05-18T08:00:00.000Z',
				},
				{
					id: 'a6',
					memberId: 'm1',
					eventType: 'announcement.created',
					entityType: 'announcement',
					entityId: 'announcement-2',
					summary: 'Ava hat einen Pinnwand-Beitrag erstellt.',
					metadataJson: JSON.stringify({
						contentPreview: 'Paket im Flur',
						kind: 'question',
						hasImage: true,
					}),
					createdAt: '2026-05-18T07:00:00.000Z',
				},
				{
					id: 'a7',
					memberId: 'm1',
					eventType: 'notification.settings.updated',
					entityType: 'member',
					entityId: 'm1',
					summary: 'Ava hat Benachrichtigungseinstellungen geändert.',
					metadataJson: JSON.stringify({
						notificationFields: ['Web Push', 'Ruhezeit Start', 'Ruhezeit Ende'],
						pushOptIn: true,
						quietStartHour: 22,
						quietEndHour: 7,
					}),
					createdAt: '2026-05-18T06:00:00.000Z',
				},
			],
		});

		expect(items.map((item) => item.detail)).toEqual([
			'Alt-WG → ManaWG · Beitritt offen · neuer WG-Code',
			'„Bin dabei“ · Reaktion: take',
			'Internet · 32,90 € · 2 Aufteilungen · monatlich · nächste Fälligkeit 18.06.',
			'Urlaub · abwesend 20.05. bis 22.05.',
			'Milch · 2x',
			'„Paket im Flur“ · Typ: question · mit Bild',
			'Web Push, Ruhezeit Start, Ruhezeit Ende · Web Push aktiv · Ruhezeit 22-7 Uhr',
		]);
		expect(items.map((item) => item.href)).toEqual([
			'/einstellungen#zugang',
			'/pinnwand#announcement-announcement-1',
			'/ausgaben?recurring=recurring-1',
			'/putzen?panel=absences&absence=absence-1',
			'/einkauf?highlight=shopping-1',
			'/pinnwand#announcement-announcement-2',
			'/einstellungen#benachrichtigungen',
		]);
	});

	it('shows when notification quiet hours are disabled in audit detail', () => {
		const items = buildActivityTimeline({
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [],
			shoppingItems: [],
			announcements: [],
			choreCompletions: [],
			recurringExpenses: [],
			absences: [],
			auditEvents: [
				{
					id: 'a1',
					memberId: 'm1',
					eventType: 'notification.settings.updated',
					entityType: 'member',
					entityId: 'm1',
					summary: 'Ava hat Benachrichtigungseinstellungen geändert.',
					metadataJson: JSON.stringify({
						notificationFields: ['Ruhezeit Start', 'Ruhezeit Ende'],
						quietStartHour: null,
						quietEndHour: null,
					}),
					createdAt: '2026-05-18T06:00:00.000Z',
				},
			],
		});

		expect(items[0]?.detail).toBe('Ruhezeit Start, Ruhezeit Ende · Ruhezeit aus');
		expect(items[0]?.href).toBe('/einstellungen#benachrichtigungen');
	});

	it('keeps advanced recurring expense audit entries actionable', () => {
		const items = buildActivityTimeline({
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [],
			shoppingItems: [],
			announcements: [],
			choreCompletions: [],
			recurringExpenses: [],
			absences: [],
			auditEvents: [
				{
					id: 'a1',
					memberId: 'm1',
					eventType: 'recurring.advanced',
					entityType: 'recurring_expense',
					entityId: 'recurring-1',
					summary: 'Internet wurde aus einer Fixkosten-Vorlage übernommen.',
					metadataJson: JSON.stringify({
						description: 'Internet',
						amountCents: 3290,
						intervalMonths: 1,
						nextDueAt: '2026-06-18T00:00:00.000Z',
						lastCreatedAt: '2026-05-18T10:00:00.000Z',
						splitCount: 2,
					}),
					createdAt: '2026-05-18T10:00:00.000Z',
				},
			],
		});

		expect(items[0]).toMatchObject({
			kind: 'audit',
			memberName: 'Ava',
			text: 'Internet wurde aus einer Fixkosten-Vorlage übernommen.',
			detail: 'Internet · 32,90 € · 2 Aufteilungen · monatlich · nächste Fälligkeit 18.06.',
			href: '/ausgaben?recurring=recurring-1',
		});
	});

	it('links deleted recurring template audit entries to the recurring overview', () => {
		const items = buildActivityTimeline({
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [],
			shoppingItems: [],
			announcements: [],
			choreCompletions: [],
			recurringExpenses: [],
			absences: [],
			auditEvents: [
				{
					id: 'a1',
					memberId: 'm1',
					eventType: 'recurring.deleted',
					entityType: 'recurring_expense',
					entityId: 'recurring-1',
					summary: 'Ava hat die Fixkosten-Vorlage Internet gelöscht.',
					metadataJson: JSON.stringify({ description: 'Internet' }),
					createdAt: '2026-05-18T10:00:00.000Z',
				},
			],
		});

		expect(items[0]).toMatchObject({
			kind: 'audit',
			memberName: 'Ava',
			text: 'hat die Fixkosten-Vorlage Internet gelöscht.',
			detail: 'Internet',
			href: '/ausgaben?filter=recurring',
		});
	});

	it('keeps audit date metadata readable when stored dates are invalid', () => {
		const items = buildActivityTimeline({
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [],
			shoppingItems: [],
			announcements: [],
			choreCompletions: [],
			recurringExpenses: [],
			absences: [],
			auditEvents: [
				{
					id: 'a1',
					memberId: 'm1',
					eventType: 'absence.created',
					summary: 'Ava hat eine Abwesenheit eingetragen.',
					metadataJson: JSON.stringify({
						startDate: 'broken',
						endDate: '2026-05-22T12:00:00.000Z',
					}),
					createdAt: '2026-05-18T06:00:00.000Z',
				},
			],
		});

		expect(items[0]?.detail).toBe('abwesend Datum unbekannt bis 22.05.');
	});

	it('avoids repeating the actor name for audit summaries that already include it', () => {
		const items = buildActivityTimeline({
			members: [{ id: 'm1', name: 'Ava' }],
			expenses: [],
			shoppingItems: [],
			announcements: [],
			choreCompletions: [],
			auditEvents: [
				{
					id: 'a1',
					memberId: 'm1',
					eventType: 'shopping.created',
					summary: 'Ava hat Milch auf die Einkaufsliste gesetzt.',
					createdAt: '2026-05-18T12:00:00.000Z',
				},
				{
					id: 'a2',
					memberId: null,
					eventType: 'system.notice',
					summary: 'System hat eine Erinnerung gesendet.',
					createdAt: '2026-05-18T11:00:00.000Z',
				},
			],
		});

		expect(items.map((item) => `${item.memberName} ${item.text}`)).toEqual([
			'Ava hat Milch auf die Einkaufsliste gesetzt.',
			'System hat eine Erinnerung gesendet.',
		]);
	});
});

describe('formatAuditActivityText', () => {
	it('removes an already rendered actor prefix only when it matches', () => {
		expect(formatAuditActivityText('Ava hat Milch eingetragen.', 'Ava')).toBe(
			'hat Milch eingetragen.',
		);
		expect(formatAuditActivityText('Ben hat Milch eingetragen.', 'Ava')).toBe(
			'Ben hat Milch eingetragen.',
		);
	});
});

describe('filterActivityItems', () => {
	it('filters by kind, ownership, and text query', () => {
		const items = [
			{
				id: '1',
				kind: 'expense' as const,
				timestamp: '2026-05-18T10:00:00.000Z',
				memberName: 'Ava',
				text: 'Miete',
			},
			{
				id: '2',
				kind: 'shopping' as const,
				timestamp: '2026-05-18T09:00:00.000Z',
				memberName: 'Ben',
				text: 'Milch gekauft',
			},
			{
				id: '3',
				kind: 'recurring' as const,
				timestamp: '2026-05-18T08:00:00.000Z',
				memberName: 'Ava',
				text: 'Internet als Fixkosten-Vorlage angelegt',
			},
			{
				id: '4',
				kind: 'absence' as const,
				timestamp: '2026-05-18T07:00:00.000Z',
				memberName: 'Ben',
				text: 'ist abwesend',
				detail: '20.05.-22.05. · Urlaub',
			},
		];

		expect(
			filterActivityItems(items, { kind: 'shopping', mineOnly: false, query: 'milch' }, 'Ava').map(
				(item) => item.id,
			),
		).toEqual(['2']);
		expect(
			filterActivityItems(items, { kind: 'all', mineOnly: true, query: '' }, 'Ava').map(
				(item) => item.id,
			),
		).toEqual(['1', '3']);
		expect(
			filterActivityItems(
				items,
				{ kind: 'recurring', mineOnly: false, query: 'internet' },
				'Ben',
			).map((item) => item.id),
		).toEqual(['3']);
		expect(
			filterActivityItems(items, { kind: 'absence', mineOnly: false, query: 'urlaub' }, 'Ava').map(
				(item) => item.id,
			),
		).toEqual(['4']);
	});

	it('uses member ids for ownership when names are duplicated', () => {
		const items = [
			{
				id: '1',
				kind: 'expense' as const,
				timestamp: '2026-05-18T10:00:00.000Z',
				memberName: 'Ava',
				memberId: 'm1',
				text: 'Miete',
			},
			{
				id: '2',
				kind: 'shopping' as const,
				timestamp: '2026-05-18T09:00:00.000Z',
				memberName: 'Ava',
				memberId: 'm2',
				text: 'Milch gekauft',
			},
		];

		expect(
			filterActivityItems(items, { kind: 'all', mineOnly: true, query: '' }, 'Ava', 'm1').map(
				(item) => item.id,
			),
		).toEqual(['1']);
		expect(filterActivityByScope(items, 'mine', 'Ava', 'm1').map((item) => item.id)).toEqual(['1']);
	});

	it('searches audit detail text as well as the visible title', () => {
		const items = [
			{
				id: '1',
				kind: 'audit' as const,
				timestamp: '2026-05-18T10:00:00.000Z',
				memberName: 'Ava',
				text: 'Ava hat die WG-Einstellungen geändert.',
				detail: 'Beitritt gesperrt',
			},
		];

		expect(
			filterActivityItems(items, { kind: 'audit', mineOnly: false, query: 'gesperrt' }, 'Ben').map(
				(item) => item.id,
			),
		).toEqual(['1']);
	});
});

describe('activity chronicle helpers', () => {
	const items = [
		{
			id: '1',
			kind: 'announcement' as const,
			timestamp: '2026-05-18T10:00:00.000Z',
			memberName: 'Ava',
			text: 'Fenster ist offen',
		},
		{
			id: '2',
			kind: 'chore' as const,
			timestamp: '2026-05-17T09:00:00.000Z',
			memberName: 'Ben',
			text: 'Bad erledigt',
		},
		{
			id: '3',
			kind: 'shopping' as const,
			timestamp: '2026-05-17T08:00:00.000Z',
			memberName: 'System',
			text: 'Milch hinzugefügt',
		},
	];

	it('groups activity by calendar day with friendly labels', () => {
		expect(
			groupActivityItemsByDay(items, NOW).map((group) => [group.label, group.items.length]),
		).toEqual([
			['Heute', 1],
			['Gestern', 2],
		]);
	});

	it('filters activity by high-level chronicle scopes', () => {
		expect(filterActivityByScope(items, 'system', 'Ava').map((item) => item.id)).toEqual(['3']);
		expect(filterActivityByScope(items, 'mine', 'Ava').map((item) => item.id)).toEqual(['1']);
		expect(filterActivityByScope(items, 'done', 'Ava').map((item) => item.id)).toEqual(['2']);
		expect(filterActivityByScope(items, 'changes', 'Ava').map((item) => item.id)).toEqual([
			'1',
			'3',
		]);
	});
});

describe('getActivityReminders', () => {
	it('flags stale shopping items and escalated chores', () => {
		expect(
			getActivityReminders(
				{
					openShoppingItems: [{ id: 's1', name: 'Milch', createdAt: '2026-05-14T12:00:00.000Z' }],
					dueChores: [
						{ id: 'c1', title: 'Bad', nextDueAt: '2026-05-15T12:00:00.000Z', assignedName: 'Ava' },
					],
				},
				NOW,
			),
		).toEqual([
			{
				kind: 'chore',
				title: 'Bad hängt seit 3 Tagen',
				href: '/putzen?highlight=c1',
				detail: 'Ava ist eingetragen. Nachholen, übernehmen oder kurz klären.',
			},
			{
				kind: 'shopping',
				title: 'Milch liegt seit 4 Tagen offen',
				href: '/einkauf?highlight=s1',
				detail: 'Prüft kurz, ob ihr das noch braucht.',
			},
		]);
	});

	it('encodes entity ids in reminder links', () => {
		expect(
			getActivityReminders(
				{
					openShoppingItems: [
						{
							id: 'shopping 1&open=true',
							name: 'Milch',
							createdAt: '2026-05-14T12:00:00.000Z',
						},
					],
					dueChores: [
						{
							id: 'chore 1&tab=all',
							title: 'Bad',
							nextDueAt: '2026-05-15T12:00:00.000Z',
							assignedName: null,
						},
					],
					openAnnouncements: [
						{
							id: 'pin/1?focus=comments',
							content: 'Wer kann das Paket reinholen?',
							kind: 'question',
							createdAt: '2026-05-15T12:00:00.000Z',
						},
					],
				},
				NOW,
			).map((item) => [item.kind, item.href]),
		).toEqual([
			['chore', '/putzen?highlight=chore%201%26tab%3Dall'],
			['announcement', '/pinnwand#announcement-pin%2F1%3Ffocus%3Dcomments'],
			['shopping', '/einkauf?highlight=shopping%201%26open%3Dtrue'],
		]);
	});

	it('flags older open announcement questions as reminders', () => {
		expect(
			getActivityReminders(
				{
					openShoppingItems: [],
					dueChores: [],
					openAnnouncements: [
						{
							id: 'a1',
							content: 'Wer kann das Paket reinholen?',
							kind: 'question',
							createdAt: '2026-05-15T12:00:00.000Z',
						},
						{
							id: 'a2',
							content: 'Nur Info',
							kind: 'info',
							createdAt: '2026-05-10T12:00:00.000Z',
						},
					],
				},
				NOW,
			),
		).toEqual([
			{
				kind: 'announcement',
				title: 'Pinnwand offen seit 3 Tagen',
				href: '/pinnwand#announcement-a1',
				detail: 'Wer kann das Paket reinholen?',
			},
		]);
	});

	it('requires full elapsed days before surfacing announcement reminders', () => {
		expect(
			getActivityReminders(
				{
					openShoppingItems: [],
					dueChores: [],
					openAnnouncements: [
						{
							id: 'a1',
							content: 'Wer kann das Paket reinholen?',
							kind: 'question',
							createdAt: '2026-05-16T23:59:59.000Z',
						},
					],
				},
				NOW,
			),
		).toEqual([]);

		expect(
			getActivityReminders(
				{
					openShoppingItems: [],
					dueChores: [],
					openAnnouncements: [
						{
							id: 'a1',
							content: 'Wer kann das Paket reinholen?',
							kind: 'question',
							createdAt: '2026-05-16T12:00:00.000Z',
						},
					],
				},
				NOW,
			),
		).toEqual([
			{
				kind: 'announcement',
				title: 'Pinnwand offen seit 2 Tagen',
				href: '/pinnwand#announcement-a1',
				detail: 'Wer kann das Paket reinholen?',
			},
		]);
	});

	it('requires full elapsed days before surfacing shopping reminders', () => {
		expect(
			getActivityReminders(
				{
					openShoppingItems: [{ id: 's1', name: 'Milch', createdAt: '2026-05-16T00:00:00.000Z' }],
					dueChores: [],
				},
				NOW,
			),
		).toEqual([]);

		expect(
			getActivityReminders(
				{
					openShoppingItems: [{ id: 's1', name: 'Milch', createdAt: '2026-05-15T12:00:00.000Z' }],
					dueChores: [],
				},
				NOW,
			),
		).toEqual([
			{
				kind: 'shopping',
				title: 'Milch liegt seit 3 Tagen offen',
				href: '/einkauf?highlight=s1',
				detail: 'Prüft kurz, ob ihr das noch braucht.',
			},
		]);
	});

	it('keeps stale open announcements visible before stale shopping noise', () => {
		const reminders = getActivityReminders(
			{
				openShoppingItems: Array.from({ length: 7 }, (_, index) => ({
					id: `s${index}`,
					name: `Artikel ${index}`,
					createdAt: '2026-05-12T12:00:00.000Z',
				})),
				dueChores: [],
				openAnnouncements: [
					{
						id: 'a1',
						content: 'Kann jemand den Handwerker reinlassen?',
						kind: 'request',
						createdAt: '2026-05-16T12:00:00.000Z',
					},
				],
			},
			NOW,
		);

		expect(reminders).toHaveLength(6);
		expect(reminders[0]).toMatchObject({
			kind: 'announcement',
			href: '/pinnwand#announcement-a1',
		});
		expect(reminders.map((item) => item.href)).toContain('/pinnwand#announcement-a1');
	});

	it('ignores stale-shopping reminders with invalid creation dates', () => {
		expect(
			getActivityReminders(
				{
					openShoppingItems: [{ id: 's1', name: 'Milch', createdAt: 'broken' }],
					dueChores: [],
				},
				NOW,
			),
		).toEqual([]);
	});
});

describe('buildActivityInbox', () => {
	it('turns reminders and personal activity into actionable inbox items', () => {
		const inbox = buildActivityInbox({
			reminders: [
				{
					kind: 'chore',
					title: 'Bad hängt seit 3 Tagen',
					detail: 'Ava ist eingetragen.',
					href: '/putzen?highlight=c1',
				},
			],
			items: [
				{
					id: 'e1',
					kind: 'expense',
					timestamp: '2026-05-18T10:00:00.000Z',
					memberName: 'Ava',
					text: 'Strom',
					amountCents: 4800,
					href: '/ausgaben?highlight=e1',
				},
				{
					id: 's1',
					kind: 'shopping',
					timestamp: '2026-05-18T09:00:00.000Z',
					memberName: 'Ben',
					text: 'Milch',
				},
				{
					id: 'a1',
					kind: 'audit',
					timestamp: '2026-05-18T08:00:00.000Z',
					memberName: 'Ava',
					text: 'hat Benachrichtigungseinstellungen geändert.',
					href: '/einstellungen#benachrichtigungen',
				},
			],
			currentMemberName: 'Ava',
		});

		expect(inbox.map((item) => [item.priority, item.title, item.detail, item.href])).toEqual([
			['high', 'Bad hängt seit 3 Tagen', 'Ava ist eingetragen.', '/putzen?highlight=c1'],
			['normal', 'Strom', 'Deine Ausgabe', '/ausgaben?highlight=e1'],
			[
				'normal',
				'hat Benachrichtigungseinstellungen geändert.',
				'Deine Änderung',
				'/einstellungen#benachrichtigungen',
			],
		]);
	});

	it('uses member ids for personal inbox items when names are duplicated', () => {
		const inbox = buildActivityInbox({
			reminders: [],
			items: [
				{
					id: 'mine',
					kind: 'expense',
					timestamp: '2026-05-18T10:00:00.000Z',
					memberName: 'Ava',
					memberId: 'm1',
					text: 'Strom',
					href: '/ausgaben?highlight=mine',
				},
				{
					id: 'other',
					kind: 'shopping',
					timestamp: '2026-05-18T09:00:00.000Z',
					memberName: 'Ava',
					memberId: 'm2',
					text: 'Milch',
					href: '/einkauf?highlight=other',
				},
			],
			currentMemberName: 'Ava',
			currentMemberId: 'm1',
		});

		expect(inbox.map((item) => item.id)).toEqual(['activity:expense:mine']);
	});
});
