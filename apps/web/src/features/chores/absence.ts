import { berlinDayKey } from '@/core/utils/berlin-day';
import { parseTimestamp } from '@/core/utils/time';

export interface AbsenceInput {
	id: string;
	memberId: string;
	memberName: string;
	startDate: string;
	endDate: string;
	reason: string | null;
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

/** Without the panel open only the first four; an absence selected by link stays visible. */
export function pickVisibleAbsences(
	absences: AbsenceInput[],
	showAll: boolean,
	selectedId: string | null,
): AbsenceInput[] {
	if (showAll) return absences;
	const firstItems = absences.slice(0, 4);
	const selected = absences.find((absence) => absence.id === selectedId);
	if (!selected || firstItems.some((absence) => absence.id === selected.id)) return firstItems;
	return [selected, ...firstItems].slice(0, 4);
}
