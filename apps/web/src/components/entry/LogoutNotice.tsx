'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

const LOGOUT_NOTICE_KEY = 'manawg-logout-notice';

/** Carries a warning from a finished sign-out to the public page the visitor lands on. */
export function rememberLogoutNotice(message: string): void {
	try {
		sessionStorage.setItem(LOGOUT_NOTICE_KEY, message);
	} catch {
		// Without session storage the sign-out still happened; only the hint is lost.
	}
}

export function LogoutNotice() {
	const [message, setMessage] = useState<string | null>(null);
	useEffect(() => {
		try {
			const stored = sessionStorage.getItem(LOGOUT_NOTICE_KEY);
			if (!stored) return;
			sessionStorage.removeItem(LOGOUT_NOTICE_KEY);
			setMessage(stored);
		} catch {
			setMessage(null);
		}
	}, []);
	if (!message) return null;
	return (
		<div className="mx-auto w-full max-w-md px-4 pt-4">
			<Alert>
				<AlertDescription>{message}</AlertDescription>
			</Alert>
		</div>
	);
}
