import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { createAction, makeQueueModule, restoreGlobals } from './support/offline-harness.ts';

afterEach(restoreGlobals);

const { holdsImageReview, holdsServerReview, failedWithoutConnection, requestFailureState } =
	await import('../src/core/offline/offline-failure-copy.ts');

const withImage = { payload: { content: 'x', kind: 'info', imageUrl: 'manawg-pending-image:1' } };

test('each legacy German prefix still holds an action for manual resolution', async () => {
	const { module } = await makeQueueModule();
	for (const lastError of [
		'Server prüfen: Konflikt',
		'Bild fehlt: weg',
		'Bild wurde entfernt: ok',
	]) {
		assert.equal(
			module.needsManualOfflineResolution(createAction({ ...withImage, lastError })),
			true,
			lastError,
		);
	}
	assert.equal(
		module.needsManualOfflineResolution(createAction({ lastError: 'Bild fehlt: x' })),
		false,
	);
	assert.equal(
		module.needsManualOfflineResolution(
			createAction({ lastError: 'Noch keine Verbindung: später' }),
		),
		false,
	);
});

test('the review flags hold an action without any German text', async () => {
	const { module } = await makeQueueModule();
	assert.equal(module.needsManualOfflineResolution(createAction({ needsReview: 'server' })), true);
	for (const needsReview of ['imageMissing', 'imageRemoved']) {
		assert.equal(
			module.needsManualOfflineResolution(createAction({ ...withImage, needsReview })),
			true,
			needsReview,
		);
		assert.equal(
			module.needsManualOfflineResolution(createAction({ needsReview })),
			false,
			needsReview,
		);
	}
});

test('a failure state carries flags, a message and the legacy markers', () => {
	const rejected = requestFailureState(404, 'chore_not_found', true);
	assert.equal(rejected.needsReview, 'server');
	assert.equal(rejected.lastError?.startsWith('Server prüfen:'), true);
	assert.equal(rejected.lastErrorMessage?.key, 'offline.state.serverCheck');

	const offline = requestFailureState(0, 'network', false);
	assert.equal(offline.noConnection, true);
	assert.equal(offline.lastError?.startsWith('Noch keine Verbindung'), true);

	const retryable = requestFailureState(503, undefined, false);
	assert.equal(retryable.needsReview, undefined);
	assert.equal(retryable.noConnection, undefined);
	assert.ok(retryable.lastError);
});

test('legacy and flagged actions are recognised by the same helpers', () => {
	assert.equal(holdsServerReview(createAction({ lastError: 'Server prüfen: x' }) as never), true);
	assert.equal(holdsServerReview(createAction({ needsReview: 'server' }) as never), true);
	assert.equal(holdsServerReview(createAction({ lastError: '503' }) as never), false);
	assert.equal(failedWithoutConnection(createAction({ noConnection: true }) as never), true);
	assert.equal(
		failedWithoutConnection(createAction({ lastError: 'Noch keine Verbindung: x' }) as never),
		true,
	);
	assert.equal(holdsImageReview(createAction({ needsReview: 'imageRemoved' }) as never), true);
	assert.equal(holdsImageReview(createAction({ lastError: 'Bild fehlt: x' }) as never), true);
	assert.equal(holdsImageReview(createAction({ lastError: 'Server prüfen: x' }) as never), false);
});
