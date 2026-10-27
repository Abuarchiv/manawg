import assert from 'node:assert/strict';
import test from 'node:test';
import { QUIET_HOURS_HINT, isQuietHoursActive } from './notification-preferences';
import { notificationPriorityForEvent } from './notifications';

test('Ruhezeit-Hinweis passt zur Zustellung', () => {
	for (const event of ['chore.due', 'event.upcoming', 'event.today'] as const) {
		assert.equal(notificationPriorityForEvent(event), 'urgent');
	}
	for (const event of ['expense.reminder', 'chat.message'] as const) {
		assert.equal(notificationPriorityForEvent(event), 'normal');
	}
	assert.equal(isQuietHoursActive(23, 22, 7), true);
	for (const part of ['Fällige Aufgaben', 'Termine', 'nicht nachgeschickt', 'per E-Mail']) {
		assert.ok(QUIET_HOURS_HINT.includes(part), part);
	}
});
