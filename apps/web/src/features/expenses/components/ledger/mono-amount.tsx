/**
 * Monospace tabular amount for `t.rich`, so the catalog keeps a plain `{amount}`.
 * A plain ICU argument takes an element at runtime; the typed signature lists only strings.
 */
export function monoAmount(text: string): string {
	return (<span className="font-mono tabular-nums">{text}</span>) as unknown as string;
}
