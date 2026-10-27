import {
	ANNOUNCEMENT_KINDS,
	type AnnouncementKind,
} from '@/features/pinnwand/announcement-workflow';

export const KIND_LABELS: Record<AnnouncementKind, string> = {
	info: 'Info',
	question: 'Frage',
	problem: 'Problem',
	request: 'Bitte',
	decision: 'Entscheidung',
};

export const KIND_OPTIONS: ReadonlyArray<{ value: AnnouncementKind; label: string }> =
	ANNOUNCEMENT_KINDS.map((value) => ({ value, label: KIND_LABELS[value] }));
