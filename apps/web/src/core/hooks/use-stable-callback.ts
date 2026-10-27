import { useCallback, useLayoutEffect, useRef } from 'react';

/** Stable function identity that always calls the latest closure, so `memo` rows survive parent renders. */
export function useStableCallback<A extends unknown[], R>(
	fn: (...args: A) => R,
): (...args: A) => R {
	const ref = useRef(fn);
	useLayoutEffect(() => {
		ref.current = fn;
	});
	return useCallback((...args: A) => ref.current(...args), []);
}
