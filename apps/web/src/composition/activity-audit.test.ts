import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const schema = await import('@/core/db/schema');
mock.module('@/core/db', { namedExports: { ...schema, db: {} } });
mock.module('@/core/infra/observability', {
	namedExports: { captureException: () => undefined, logApiError: () => undefined },
});

const { auditActivitySentence, auditDetail } = await import('./activity-audit');
const { buildActivityTimeline } = await import('./activity');
const { serverRenderContext } = await import('@/core/i18n/render-context');

const NEW_ROW = {
	eventType: 'shopping.bought',
	summary: 'Anna hat Brot gekauft.',
	metadataJson: JSON.stringify({ name: 'Brot' }),
};
const LEGACY_ROW = {
	eventType: 'chore.completed',
	summary: 'Anna hat Bad erledigt.',
	metadataJson: JSON.stringify({ nextAssignedMemberId: 'm2' }),
};

test('a row with its parameters renders in the reader locale with the reader own verb form', () => {
	assert.deepEqual(auditActivitySentence(NEW_ROW, 'Anna', serverRenderContext('en')), {
		text: 'bought Brot.',
	});
	assert.deepEqual(auditActivitySentence(NEW_ROW, 'Anna', serverRenderContext('de')), {
		text: 'hat Brot gekauft.',
		selfText: 'hast Brot gekauft.',
	});
});

test('a row written before the parameters shows its stored German sentence in every locale', () => {
	for (const locale of ['de', 'en'] as const) {
		assert.deepEqual(auditActivitySentence(LEGACY_ROW, 'Anna', serverRenderContext(locale)), {
			text: 'hat Bad erledigt.',
			selfText: 'hast Bad erledigt.',
		});
	}
});

test('passive sentences and calls without a translator keep the stored summary', () => {
	const passive = {
		eventType: 'recurring.charged',
		summary: 'Fixkosten-Buchung Miete wurde automatisch eingetragen.',
		metadataJson: JSON.stringify({ description: 'Miete' }),
	};
	assert.deepEqual(auditActivitySentence(passive, 'System', serverRenderContext('en')), {
		text: 'Miete was added automatically from fixed costs.',
	});
	assert.deepEqual(auditActivitySentence(NEW_ROW, 'Anna'), {
		text: 'hat Brot gekauft.',
		selfText: 'hast Brot gekauft.',
	});
});

test('the timeline renders audit rows, system rows and details per locale', () => {
	const input = {
		members: [{ id: 'm1', name: 'Anna' }],
		expenses: [],
		shoppingItems: [],
		announcements: [],
		choreCompletions: [],
		auditEvents: [
			{
				id: 'a1',
				memberId: 'm1',
				...NEW_ROW,
				metadataJson: JSON.stringify({ name: 'Brot', hasImage: true }),
				createdAt: '2026-10-01T10:00:00.000Z',
			},
			{
				id: 'a2',
				memberId: null,
				eventType: 'recurring.advanced',
				summary: 'Miete wurde aus einer Fixkosten-Vorlage übernommen.',
				metadataJson: JSON.stringify({
					description: 'Miete',
					nextDueAt: '2026-11-01T00:00:00.000Z',
				}),
				createdAt: '2026-10-01T09:00:00.000Z',
			},
		],
	};
	const [german, system] = buildActivityTimeline(input, serverRenderContext('de'));
	assert.equal(german?.text, 'hat Brot gekauft.');
	assert.equal(german?.selfText, 'hast Brot gekauft.');
	assert.equal(german?.detail, 'mit Bild');
	assert.equal(system?.memberName, 'System');
	const [english, englishSystem] = buildActivityTimeline(input, serverRenderContext('en'));
	assert.equal(english?.text, 'bought Brot.');
	assert.equal(english?.selfText, undefined);
	assert.equal(english?.detail, 'with image');
	assert.equal(englishSystem?.text, 'Miete was taken from a fixed-cost template.');
	assert.equal(englishSystem?.detail, 'Miete · next due 1 Nov');
});

test('details follow the locale; notification fields stored as keys are translated, labels stay', () => {
	const json = JSON.stringify({
		notificationFields: ['notifyChat', 'Pinnwand'],
		intervalDays: 14,
		splitIds: ['a'],
	});
	assert.equal(
		auditDetail(json, serverRenderContext('de')),
		'Chat, Pinnwand · alle 14 Tage · 1 Anteil',
	);
	assert.equal(
		auditDetail(json, serverRenderContext('en')),
		'Chat, Pinnwand · every 14 days · 1 share',
	);
});

test('the dashboard feed renders its sentences in the reader locale', async () => {
	const { appendSecondaryActivity } = await import('./dashboard-feed');
	const members = new Map([['m1', { name: 'Anna' }]]);
	const audit = {
		id: 'a1',
		memberId: 'm1',
		createdAt: new Date('2026-10-01T10:00:00Z'),
		entityType: 'shopping_item',
		entityId: null,
		...NEW_ROW,
	};
	const absence = { id: 'x', memberId: 'm1', createdAt: new Date('2026-10-01T09:00:00Z') };
	const feed = (locale: 'de' | 'en') => {
		const activity: Parameters<typeof appendSecondaryActivity>[0] = [];
		appendSecondaryActivity(
			activity,
			new Map(),
			[absence] as never,
			[],
			[audit] as never,
			members,
			'CODE',
			serverRenderContext(locale),
		);
		return activity.map((item) => item.text);
	};
	assert.deepEqual(feed('de'), ['hat Brot gekauft.', 'Abwesenheit eingetragen']);
	assert.deepEqual(feed('en'), ['bought Brot.', 'Time away added']);
});
