'use client';

import { useEffect } from 'react';

/**
 * Fills an empty name field with the account's name once the visitor is signed in
 * (Google profile or the sign-up form); a typed or restored name is never overwritten.
 */
export function useAccountNamePrefill(
	authenticated: boolean,
	setName: (update: (current: string) => string) => void,
): void {
	useEffect(() => {
		if (!authenticated) return;
		let active = true;
		import('@/core/auth/client')
			.then(({ getAccountName }) => getAccountName())
			.then((name) => {
				if (!active || !name) return;
				setName((current) => current || name);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [authenticated, setName]);
}
