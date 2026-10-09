import assert from 'node:assert/strict';
import test from 'node:test';
import { HIDDEN_FROM_FEED_EVENT_TYPES, publicAuditMetadata } from '@/core/audit-visibility';

test('notification settings keep the changed fields but not push state or quiet hours', () => {
	const json = JSON.stringify({
		notificationFields: ['chores'],
		pushOptIn: true,
		quietStartHour: 22,
		quietEndHour: 7,
	});
	assert.deepEqual(JSON.parse(publicAuditMetadata('notification.settings.updated', json) ?? '{}'), {
		notificationFields: ['chores'],
	});
});

test('the creation-time share code is not shared', () => {
	const json = JSON.stringify({ name: 'WG Nord', shareCode: 'MTE8PZAT' });
	assert.deepEqual(JSON.parse(publicAuditMetadata('wg.created', json) ?? '{}'), {
		name: 'WG Nord',
	});
});

test('other events and empty metadata pass through unchanged', () => {
	const json = JSON.stringify({ amountCents: 500 });
	assert.equal(publicAuditMetadata('expense.created', json), json);
	assert.equal(publicAuditMetadata('wg.created', null), null);
	assert.equal(publicAuditMetadata('wg.created', undefined), null);
});

test('unreadable metadata of a private event is withheld', () => {
	assert.equal(publicAuditMetadata('wg.created', '{not json'), null);
});

test('push opt-in and opt-out events stay out of the shared feed', () => {
	assert.ok(HIDDEN_FROM_FEED_EVENT_TYPES.includes('notification.push.subscribed'));
	assert.ok(HIDDEN_FROM_FEED_EVENT_TYPES.includes('notification.push.unsubscribed'));
});
