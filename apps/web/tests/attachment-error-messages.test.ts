import assert from 'node:assert/strict';
import test from 'node:test';
import { explainChatError } from '@/features/chat/chat-errors';
import {
	expenseActionErrorMessage,
	expenseSaveErrorMessage,
} from '@/features/expenses/expense-errors';
import { announcementCreateErrorMessage } from '@/features/pinnwand/announcement-errors';

test('online attachment error maps ask residents to upload a replacement image', () => {
	assert.match(expenseSaveErrorMessage('image_removed'), /Anhang wurde entfernt.*erneut hoch/);
	assert.match(expenseActionErrorMessage('image_removed'), /Anhang wurde entfernt.*erneut hoch/);
	assert.match(
		announcementCreateErrorMessage('image_removed'),
		/Anhang wurde entfernt.*erneut hoch/,
	);
	assert.equal(
		explainChatError('send', 'image_removed'),
		'Dieses Bild wurde entfernt. Lade es erneut hoch, bevor du die Nachricht sendest.',
	);
});
