import type { AnnouncementKind } from '@/components/wg/pinnwand/announcement-types';
import type { AnnouncementFilter } from '@/lib/announcement-workflow';

export const CONTENT_MAX = 2000;
export const REFRESH_INTERVAL_MS = 30_000;

export const KIND_OPTIONS: ReadonlyArray<{ value: AnnouncementKind; label: string }> = [
	{ value: 'info', label: 'Info' },
	{ value: 'question', label: 'Frage' },
	{ value: 'problem', label: 'Problem' },
	{ value: 'request', label: 'Bitte' },
	{ value: 'decision', label: 'Entscheidung' },
];

export const QUICK_ANNOUNCEMENT_TEMPLATES: ReadonlyArray<{
	label: string;
	content: string;
	kind: AnnouncementKind;
}> = [
	{ label: 'Paket im Flur', content: 'Paket im Flur', kind: 'info' },
	{
		label: 'Küche kurz klären',
		content: 'Bitte Küche nach dem Kochen kurz sauber machen.',
		kind: 'request',
	},
	{ label: 'Besuch heute Abend', content: 'Heute Abend kommt Besuch vorbei.', kind: 'info' },
	{
		label: 'Wer kann helfen?',
		content: 'Wer kann kurz helfen?',
		kind: 'question',
	},
];

export const KIND_LABELS: Record<AnnouncementKind, string> = {
	info: 'Info',
	question: 'Frage',
	problem: 'Problem',
	request: 'Bitte',
	decision: 'Entscheidung',
};

export const STATUS_FILTERS: ReadonlyArray<{ value: AnnouncementFilter['status']; label: string }> =
	[
		{ value: 'all', label: 'Alle' },
		{ value: 'open', label: 'Offen' },
		{ value: 'resolved', label: 'Geklärt' },
	];
