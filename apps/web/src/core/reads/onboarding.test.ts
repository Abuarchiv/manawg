import { describe, expect, it } from 'vitest';
import { getOnboardingChecklist, getOnboardingProfile, getOnboardingProgress } from './onboarding';

describe('getOnboardingChecklist', () => {
	it('marks the core WG setup steps from dashboard data', () => {
		const checklist = getOnboardingChecklist({
			memberCount: 1,
			choreCount: 0,
			hasExpense: false,
			hasShoppingItem: true,
			hasAnnouncement: false,
			notificationsEnabled: false,
		});

		expect(checklist.map((item) => [item.id, item.done])).toEqual([
			['invite', false],
			['chores', false],
			['notifications', false],
			['firstActivity', true],
		]);
		expect(checklist.find((item) => item.id === 'firstActivity')?.href).toBe(
			'ausgaben?desc=Internet&amount=32%2C90',
		);
		expect(checklist.filter((item) => !item.done)).toHaveLength(3);
	});

	it('computes progress and next action', () => {
		const checklist = getOnboardingChecklist({
			memberCount: 2,
			choreCount: 0,
			hasExpense: false,
			hasShoppingItem: false,
			hasAnnouncement: false,
			notificationsEnabled: false,
		});

		expect(getOnboardingProgress(checklist)).toEqual({
			done: 1,
			total: 4,
			percent: 25,
			next: checklist[1],
		});
	});

	it('uses polished German labels and encoded prefill links', () => {
		expect(getOnboardingProfile('already-living').steps).toEqual([
			{ label: 'Offene Ausgaben nachtragen', href: 'ausgaben?desc=Miete&amount=500%2C00' },
			{ label: 'Wiederkehrende Aufgaben anlegen', href: 'putzen?title=K%C3%BCche+putzen' },
			{ label: 'Benachrichtigungen prüfen', href: 'settings-notifications' },
		]);
		expect(getOnboardingProfile('chores-first').steps[1]).toEqual({
			label: 'Zuständigkeiten fair verteilen',
			href: 'putzen?title=K%C3%BCche+putzen',
		});
	});
});

describe('getOnboardingProfile', () => {
	it('suggests a situation-specific setup path', () => {
		expect(getOnboardingProfile('moving-in').steps.map((step) => step.label)).toEqual([
			'Mitbewohner einladen',
			'Putzplan starten',
			'Erste gemeinsame Kosten eintragen',
		]);
		expect(getOnboardingProfile('moving-in').steps.map((step) => step.href)).toEqual([
			'settings',
			'putzen?title=Bad+putzen',
			'ausgaben?desc=Internet&amount=32%2C90',
		]);
	});
});
