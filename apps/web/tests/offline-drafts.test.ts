import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isEmptyModuleDraft } from '../src/core/offline/drafts';

describe('offline drafts', () => {
	const MEMBER = 'member-1';
	const emptyChoreDraft = {
		title: '',
		recurrenceType: 'days',
		intervalDays: 7,
		assignedMemberId: '',
		absenceMemberId: MEMBER,
		absenceStartDate: '',
		absenceEndDate: '',
		absenceReason: '',
		queueEditId: null,
	};

	test('an untouched Putzplan draft with absence fields counts as empty', () => {
		assert.equal(isEmptyModuleDraft('chore', emptyChoreDraft, MEMBER), true);
		assert.equal(isEmptyModuleDraft('chore', { ...emptyChoreDraft, title: 'Bad' }, MEMBER), false);
		assert.equal(
			isEmptyModuleDraft('chore', { ...emptyChoreDraft, absenceReason: 'Urlaub' }, MEMBER),
			false,
		);
	});
});
