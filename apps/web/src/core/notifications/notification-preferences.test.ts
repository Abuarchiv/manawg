import assert from 'node:assert/strict';
import test from 'node:test';
import { isQuietHoursActive } from './notification-preferences';
import { notificationPriorityForEvent } from './notifications';

test('urgent events break through quiet hours', () => {
	for (const event of ['chore.due', 'event.upcoming', 'event.today'] as const) {
		assert.equal(notificationPriorityForEvent(event), 'urgent');
	}
	for (const event of ['expense.reminder', 'chat.message'] as const) {
		assert.equal(notificationPriorityForEvent(event), 'normal');
	}
	assert.equal(isQuietHoursActive(23, 22, 7), true);
});
