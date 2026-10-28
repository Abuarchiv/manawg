import type { AnnouncementKind } from '@/features/pinnwand/announcement-workflow';

/** German kind names; the stored activity text (`composition/activity-audit.ts`) reads them. */
export const KIND_LABELS: Record<AnnouncementKind, string> = {
	info: 'Info', // i18n-ignore stored activity text
	question: 'Frage', // i18n-ignore stored activity text
	problem: 'Problem', // i18n-ignore stored activity text
	request: 'Bitte', // i18n-ignore stored activity text
	decision: 'Entscheidung', // i18n-ignore stored activity text
};
