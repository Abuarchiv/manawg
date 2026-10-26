/** Keys of the plan page's pending set; the hooks that start a request and the views that show its spinner share them. */
export const pendingKeys = {
	swap: (choreId: string): string => `${choreId}:swap`,
	take: (choreId: string): string => `${choreId}:take`,
	edit: (choreId: string): string => `${choreId}:edit`,
	absenceRemove: (absenceId: string): string => `absence:${absenceId}:remove`,
	ABSENCE_ADD: 'absence:add',
	CHORE_ADD: 'chore:add',
} as const;
