import { parseTimestamp } from '@/core/utils/time';

interface SecurityOverviewInput {
	memberName: string;
	memberCount: number;
	joiningEnabled: boolean;
	shareCodeRotatedAt?: string | Date | null;
}

interface SecurityOverviewItem {
	label: string;
	value: string;
}

function formatRotationDate(value: string | Date | null | undefined): string {
	if (!value) return 'Noch nicht erneuert';
	const timestamp = parseTimestamp(value);
	if (timestamp === null) return 'Datum unbekannt';
	return new Intl.DateTimeFormat('de-DE', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
	}).format(new Date(timestamp));
}

export function buildSecurityOverview(input: SecurityOverviewInput): SecurityOverviewItem[] {
	return [
		{ label: 'Identität', value: `${input.memberName} (du)` },
		{
			label: 'Mitglieder',
			value: `${input.memberCount} ${input.memberCount === 1 ? 'Person' : 'Personen'} in der WG`,
		},
		{
			label: 'Beitritt',
			value: input.joiningEnabled ? 'Neue Beitritte erlaubt' : 'Neue Beitritte gesperrt',
		},
		{
			label: 'Code erneuert',
			value: formatRotationDate(input.shareCodeRotatedAt),
		},
	];
}
