import { formatShortDateRange, parseTimestamp } from '@/lib/time';

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
	return start !== null && end !== null && start <= at && end >= at;
}

export function formatAbsenceRange(startDate: string, endDate: string): string {
	return formatShortDateRange(startDate, endDate);
}
