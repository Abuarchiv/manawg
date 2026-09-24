import { berlinDayKey } from '@/core/utils/berlin-day';
import { parseTimestamp } from '@/core/utils/time';

const berlinDateFormatter = new Intl.DateTimeFormat('de-DE', {
	timeZone: 'Europe/Berlin',
	day: '2-digit',
	month: '2-digit',
});

export interface AbsenceInput {
	id: string;
	memberId: string;
	memberName: string;
	startDate: string;
	endDate: string;
	reason: string | null;
}

export function isMemberAbsent(
	absences: Array<Pick<AbsenceInput, 'memberId' | 'startDate' | 'endDate'>>,
	memberId: string,
	at = Date.now(),
): boolean {
	return absences.some(
		(absence) =>
			absence.memberId === memberId && isAbsenceActive(absence.startDate, absence.endDate, at),
	);
}

export function getAbsentMemberIds(
	absences: Array<Pick<AbsenceInput, 'memberId' | 'startDate' | 'endDate'>>,
	at = Date.now(),
): string[] {
	return Array.from(
		new Set(
			absences
				.filter((absence) => isAbsenceActive(absence.startDate, absence.endDate, at))
				.map((absence) => absence.memberId),
		),
	);
}

function isAbsenceActive(startDate: string, endDate: string, at: number): boolean {
	const start = parseTimestamp(startDate);
	const end = parseTimestamp(endDate);
	if (start === null || end === null) return false;
	const day = berlinDayKey(new Date(at));
	return berlinDayKey(new Date(start)) <= day && day <= berlinDayKey(new Date(end));
}

export function formatAbsenceRange(startDate: string, endDate: string): string {
	const start = parseTimestamp(startDate);
	const end = parseTimestamp(endDate);
	if (start === null || end === null) return 'Datum unbekannt';
	return `${berlinDateFormatter.format(start)} bis ${berlinDateFormatter.format(end)}`;
}
