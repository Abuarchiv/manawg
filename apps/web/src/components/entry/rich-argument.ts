import type { ReactNode } from 'react';

/**
 * An element for a plain ICU argument of `t.rich`, so a catalog sentence keeps `{name}` where a
 * link goes. The runtime takes elements there; the typed signature lists only strings.
 */
export function richArgument(node: ReactNode): string {
	return node as unknown as string;
}
