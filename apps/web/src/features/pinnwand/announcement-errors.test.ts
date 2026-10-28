import assert from 'node:assert/strict';
import test from 'node:test';

const { renderMessage, serverRootT } = await import('@/core/i18n/server-t');
const { announcementActionError, announcementCreateError } = await import('./announcement-errors');

const de = serverRootT('de');
const en = serverRootT('en');

test('create errors keep their German texts', () => {
	assert.equal(
		renderMessage(de, announcementCreateError('content_invalid')),
		'Beitrag konnte nicht gespeichert werden: Der Text muss 1 bis 2000 Zeichen haben.',
	);
	assert.equal(
		renderMessage(de, announcementCreateError('whatever')),
		'Beitrag konnte nicht gespeichert werden.',
	);
	assert.equal(
		renderMessage(de, announcementCreateError('Netzwerkfehler')),
		'Beitrag konnte nicht gespeichert werden: Prüfe deine Verbindung und versuche es erneut.',
	);
});

test('action errors keep their German texts', () => {
	assert.equal(
		renderMessage(de, announcementActionError('not_owner')),
		'Aktion konnte nicht gespeichert werden: Nur wer den Beitrag geschrieben hat oder WG-Admins können ihn bearbeiten.',
	);
	assert.equal(
		renderMessage(de, announcementActionError('announcement_resolved')),
		'Dieser Beitrag wurde inzwischen geklärt.',
	);
	assert.equal(
		renderMessage(de, announcementActionError('whatever')),
		'Aktion konnte nicht gespeichert werden. Versuche es erneut.',
	);
});

test('the same codes render English', () => {
	assert.equal(
		renderMessage(en, announcementCreateError('content_invalid')),
		'The post could not be saved: The text must be 1 to 2000 characters long.',
	);
	assert.equal(
		renderMessage(en, announcementActionError('whatever')),
		'The action could not be saved. Try again.',
	);
});
