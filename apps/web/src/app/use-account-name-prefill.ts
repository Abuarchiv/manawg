'use client';

import { useEffect, useState } from 'react';

/**
 * Fills an empty name field with the account's name once the visitor is signed in
 * (Google profile or the sign-up form); a typed or restored name is never overwritten. Returns
 * true once the lookup has answered, with or without a name.
 */
export function useAccountNamePrefill(
	authenticated: boolean,
	setName: (update: (current: string) => string) => void,
): boolean {
	const [settled, setSettled] = useState(false);
	useEffect(() => {
		if (!authenticated) return;
		let active = true;
		import('@/core/auth/client')
			.then(({ getAccountName }) => getAccountName())
			.then((name) => {
				if (!active || !name) return;
				setName((current) => current || name);
			})
			.catch(() => {})
			.then(() => {
				if (active) setSettled(true);
			});
		return () => {
			active = false;
		};
	}, [authenticated, setName]);
	return settled;
}
