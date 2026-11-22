/**
 * Reads the change-poll baseline before the WG shell (roster, admin flag). A member change that
 * lands between the two reads then moves a version past the baseline, so the first poll
 * refetches the roster; read the other way round, the baseline would already contain a change
 * the rendered roster misses, and no poll would ever notice. A failed baseline read is `null`:
 * the poll's first answer then reloads everything once.
 */
export async function loadShellWithBaseline<B, S>(
	readBaseline: () => Promise<B>,
	loadShell: () => Promise<S>,
): Promise<{ baseline: B | null; shell: S }> {
	const baseline = await readBaseline().catch(() => null);
	return { baseline, shell: await loadShell() };
}
