import assert from 'node:assert/strict';
import test from 'node:test';
import type { Announcement } from '@/features/announcements/components/announcement-types';
import { isRestorableDraft, rebaseAnnouncementEdit } from './announcement-edits';

test('only restores drafts that differ from the starting text', () => {
	assert.equal(isRestorableDraft({ content: 'neu' }, 'alt'), true);
	assert.equal(isRestorableDraft({ content: 'neu' }, ''), true);
	// Cancelled or untouched edits leave the original text behind: must not reopen the editor.
	assert.equal(isRestorableDraft({ content: 'alt' }, 'alt'), false);
	assert.equal(isRestorableDraft({ content: '' }, ''), false);
	assert.equal(isRestorableDraft(null, 'alt'), false);
	assert.equal(isRestorableDraft({}, 'alt'), false);
});

const BASE = { content: 'Klopapier?', kind: 'question' } as Announcement;
const LATEST = { content: 'Klopapier und Seife?', kind: 'info' } as Announcement;

test('an untouched post field follows the latest version after a conflict', () => {
	assert.deepEqual(
		rebaseAnnouncementEdit(BASE, LATEST, { content: ' Klopapier? ', kind: 'question' }),
		{ content: 'Klopapier und Seife?', kind: 'info' },
	);
});

test('a touched post field keeps what was typed after a conflict', () => {
	assert.deepEqual(
		rebaseAnnouncementEdit(BASE, LATEST, { content: 'Neuer Text', kind: 'question' }),
		{
			content: 'Neuer Text',
			kind: 'info',
		},
	);
	assert.deepEqual(
		rebaseAnnouncementEdit(BASE, LATEST, { content: 'Klopapier?', kind: 'decision' }),
		{
			content: 'Klopapier und Seife?',
			kind: 'decision',
		},
	);
});
