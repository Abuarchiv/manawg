import assert from 'node:assert/strict';
import test from 'node:test';
import { announcementPushTitle } from './announcement-push-title';

test('the push title is one line and never ends in a broken emoji', () => {
	assert.ok(announcementPushTitle(`${'a'.repeat(119)}😀`).isWellFormed());
	assert.equal(announcementPushTitle('Putzplan\n\nneu  da'), 'Putzplan neu da');
	assert.equal(Array.from(announcementPushTitle('x'.repeat(500))).length, 120);
});
