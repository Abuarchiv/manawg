import assert from 'node:assert/strict';
import test from 'node:test';
import { pushToast } from './toast-queue';

const t = (id: string, variant: 'success' | 'error' | 'info') => ({ id, variant });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

test('keeps an unread error when a newer success pushes past the limit', () => {
	assert.deepEqual(ids(pushToast([t('e', 'error'), t('s1', 'success')], t('s2', 'success'), 2)), [
		'e',
		's2',
	]);
});

test('the incoming info is dropped before any error when the stack is full of errors', () => {
	assert.deepEqual(ids(pushToast([t('e1', 'error'), t('e2', 'error')], t('i', 'info'), 2)), [
		'e1',
		'e2',
	]);
});

test('drops the oldest error only when every toast is an error', () => {
	assert.deepEqual(ids(pushToast([t('e1', 'error'), t('e2', 'error')], t('e3', 'error'), 2)), [
		'e2',
		'e3',
	]);
});
