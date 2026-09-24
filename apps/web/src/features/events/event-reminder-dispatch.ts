export const EVENT_REMINDER_BUDGET = 10_000;
const DISPATCH_BATCH_SIZE = 10;

export function startsInReminderWindow(
	occurrence: { startsAt: string },
	start: Date,
	end: Date,
): boolean {
	const startsAt = Date.parse(occurrence.startsAt);
	return startsAt >= start.getTime() && startsAt <= end.getTime();
}

/** Complete occurrence preflight before the cron acquires any dispatch claims. */
export function collectReminderOccurrences<TRow, TOccurrence>(
	rows: readonly TRow[],
	expand: (row: TRow) => readonly TOccurrence[],
): TOccurrence[] | null {
	const due: TOccurrence[] = [];
	for (const row of rows) {
		for (const occurrence of expand(row)) {
			if (due.length === EVENT_REMINDER_BUDGET) return null;
			due.push(occurrence);
		}
	}
	return due;
}

export async function processReminderBatches<T>(
	items: readonly T[],
	claim: (item: T) => Promise<boolean>,
	dispatch: (item: T) => Promise<{ sent: number }>,
	release: (item: T) => Promise<void>,
): Promise<number> {
	let sent = 0;
	for (let index = 0; index < items.length; index += DISPATCH_BATCH_SIZE) {
		const pending: T[] = [];
		try {
			for (const item of items.slice(index, index + DISPATCH_BATCH_SIZE)) {
				if (await claim(item)) pending.push(item);
			}
		} catch (error) {
			await Promise.all(pending.map(release));
			throw error;
		}
		const results = await Promise.allSettled(pending.map(dispatch));
		const failed = pending.filter((_, resultIndex) => {
			const result = results[resultIndex];
			return (
				result?.status === 'rejected' || (result?.status === 'fulfilled' && result.value.sent === 0)
			);
		});
		await Promise.all(failed.map(release));
		sent += pending.length - failed.length;
	}
	return sent;
}
