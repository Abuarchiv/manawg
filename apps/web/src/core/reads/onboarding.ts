export type OnboardingStepId = 'invite' | 'chores' | 'notifications' | 'firstActivity';
type OnboardingProfileId = 'moving-in' | 'already-living' | 'expenses-first' | 'chores-first';

interface OnboardingInput {
	memberCount: number;
	choreCount: number;
	hasExpense: boolean;
	hasShoppingItem: boolean;
	hasAnnouncement: boolean;
	notificationsEnabled: boolean;
}

export interface OnboardingStep {
	id: OnboardingStepId;
	label: string;
	href: string;
	done: boolean;
}

interface OnboardingProgress {
	done: number;
	total: number;
	percent: number;
	next: OnboardingStep | null;
}

interface OnboardingProfileStep {
	label: string;
	href: string;
}

interface OnboardingProfile {
	id: OnboardingProfileId;
	label: string;
	steps: OnboardingProfileStep[];
}

function withQuery(path: string, params: Record<string, string>): string {
	const searchParams = new URLSearchParams(params);
	return `${path}?${searchParams.toString()}`;
}

export function getOnboardingChecklist(input: OnboardingInput): OnboardingStep[] {
	return [
		{
			id: 'invite',
			label: 'Mitglieder einladen',
			href: 'settings',
			done: input.memberCount >= 2,
		},
		{
			id: 'chores',
			label: 'Putzplan anlegen',
			href: 'putzen',
			done: input.choreCount > 0,
		},
		{
			id: 'notifications',
			label: 'Benachrichtigungen aktivieren',
			href: 'settings-notifications',
			done: input.notificationsEnabled,
		},
		{
			id: 'firstActivity',
			label: 'Erste WG-Sache eintragen',
			href: withQuery('ausgaben', { desc: 'Internet', amount: '32,90' }),
			done:
				input.hasExpense || input.hasShoppingItem || input.hasAnnouncement || input.choreCount > 0,
		},
	];
}

export function getOnboardingProgress(steps: OnboardingStep[]): OnboardingProgress {
	const total = steps.length;
	const done = steps.filter((step) => step.done).length;
	return {
		done,
		total,
		percent: total === 0 ? 100 : Math.round((done / total) * 100),
		next: steps.find((step) => !step.done) ?? null,
	};
}

const ONBOARDING_PROFILES: Record<OnboardingProfileId, OnboardingProfile> = {
	'moving-in': {
		id: 'moving-in',
		label: 'Wir ziehen neu zusammen',
		steps: [
			{ label: 'Mitbewohner einladen', href: 'settings' },
			{ label: 'Putzplan starten', href: withQuery('putzen', { title: 'Bad putzen' }) },
			{
				label: 'Erste gemeinsame Kosten eintragen',
				href: withQuery('ausgaben', { desc: 'Internet', amount: '32,90' }),
			},
		],
	},
	'already-living': {
		id: 'already-living',
		label: 'Wir wohnen schon zusammen',
		steps: [
			{
				label: 'Offene Ausgaben nachtragen',
				href: withQuery('ausgaben', { desc: 'Miete', amount: '500,00' }),
			},
			{
				label: 'Wiederkehrende Aufgaben anlegen',
				href: withQuery('putzen', { title: 'Küche putzen' }),
			},
			{ label: 'Benachrichtigungen prüfen', href: 'settings-notifications' },
		],
	},
	'expenses-first': {
		id: 'expenses-first',
		label: 'Nur Ausgaben nutzen',
		steps: [
			{
				label: 'Erste Ausgabe eintragen',
				href: withQuery('ausgaben', { desc: 'Internet', amount: '32,90' }),
			},
			{
				label: 'Aufteilung prüfen',
				href: withQuery('ausgaben', { desc: 'Einkauf', amount: '24,50' }),
			},
			{ label: 'Ausgleich vereinfachen', href: 'ausgaben' },
		],
	},
	'chores-first': {
		id: 'chores-first',
		label: 'Putzplan zuerst',
		steps: [
			{ label: 'Putzplan starten', href: withQuery('putzen', { title: 'Bad putzen' }) },
			{
				label: 'Zuständigkeiten fair verteilen',
				href: withQuery('putzen', { title: 'Küche putzen' }),
			},
			{ label: 'Erinnerungen aktivieren', href: 'settings-notifications' },
		],
	},
};

export function getOnboardingProfile(id: OnboardingProfileId): OnboardingProfile {
	return ONBOARDING_PROFILES[id];
}
