/**
 * The change-poll baseline of the WG layout, read before the WG shell (roster, admin flag). A
 * member change that lands between the two reads then moves a version past the baseline, so the
 * first poll refetches the roster; read the other way round, the baseline would already contain
 * a change the rendered roster misses, and no poll would ever notice. A failed read is `null`:
 * the poll's first answer then reloads everything once.
 */
export function readShellBaseline<B>(readBaseline: () => Promise<B>): Promise<B | null> {
	return readBaseline().catch(() => null);
}
