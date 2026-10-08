// Candidate rows and a paged loader for the event-window and reminder tests.
export function eventCandidate(
	id: string,
	startsAt: string,
	recurrence: string | null,
	{ allDay = false, endsAt = null as string | null } = {},
) {
	return {
		id,
		startsAt: new Date(startsAt),
		endsAt: endsAt ? new Date(endsAt) : null,
		allDay,
		recurrence,
	};
}

type Candidate = ReturnType<typeof eventCandidate>;

export function eventCandidatePages(rows: Candidate[], pageSizes: number[] = []) {
	const ordered = [...rows].sort(
		(a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
	);
	return async (cursor: { startsAt: Date; id: string } | null, limit: number) => {
		pageSizes.push(limit);
		const afterCursor = cursor
			? ordered.filter(
					(row) =>
						row.startsAt.getTime() > cursor.startsAt.getTime() ||
						(row.startsAt.getTime() === cursor.startsAt.getTime() && row.id > cursor.id),
				)
			: ordered;
		return afterCursor.slice(0, limit);
	};
}
