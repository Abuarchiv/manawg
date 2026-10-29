import assert from 'node:assert/strict';
import test from 'node:test';
import { REMINDER_COOLDOWN_HOURS } from '../src/features/expenses/reminders.ts';
import de from '../src/shared/i18n/messages/de/mail.ts';
import en from '../src/shared/i18n/messages/en/mail.ts';

test('the reminder mail footer names the real cooldown, not a weekly limit', () => {
	assert.equal(REMINDER_COOLDOWN_HOURS, 48);
	assert.match(en.reminder.footer, /two days/i);
	assert.match(de.reminder.footer, /zwei Tage/i);
	assert.doesNotMatch(en.reminder.footer, /week/i);
	assert.doesNotMatch(de.reminder.footer, /woche/i);
});
