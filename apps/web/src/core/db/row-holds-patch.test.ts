import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowHoldsPatch } from './row-holds-patch';

test('a row holds a patch whose every set value is stored', () => {
	const row = { title: 'Putzen', startsAt: new Date('2026-10-27T10:00:00Z'), endsAt: null };
	assert.equal(rowHoldsPatch(row, { title: 'Putzen', endsAt: null, location: undefined }), true);
	assert.equal(rowHoldsPatch(row, { startsAt: new Date('2026-10-27T10:00:00.000Z') }), true);
});

test('one differing value means the row moved on', () => {
	const row = { title: 'Putzen', startsAt: new Date('2026-10-27T10:00:00Z'), endsAt: null };
	assert.equal(rowHoldsPatch(row, { title: 'Kochen' }), false);
	assert.equal(rowHoldsPatch(row, { startsAt: new Date('2026-10-27T11:00:00Z') }), false);
	assert.equal(rowHoldsPatch(row, { endsAt: new Date('2026-10-27T11:00:00Z') }), false);
	assert.equal(rowHoldsPatch(row, { title: 'Putzen', startsAt: '2026-10-27T10:00:00Z' }), false);
});
