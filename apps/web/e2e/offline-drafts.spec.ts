import { expect, test } from '@playwright/test';
import { isEmptyModuleDraft } from '../src/core/offline/drafts';

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
	expect(isEmptyModuleDraft('chore', emptyChoreDraft, MEMBER)).toBe(true);
	expect(isEmptyModuleDraft('chore', { ...emptyChoreDraft, title: 'Bad' }, MEMBER)).toBe(false);
	expect(isEmptyModuleDraft('chore', { ...emptyChoreDraft, absenceReason: 'Urlaub' }, MEMBER)).toBe(
		false,
	);
});
