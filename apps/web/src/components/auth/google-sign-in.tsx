'use client';

import { createContext, type ReactNode, useContext } from 'react';

// Read on the server at request time (`GOOGLE_SIGN_IN`), so one Docker image serves instances
// with and without a Google OAuth client. Unset means on.
const GoogleSignInContext = createContext(true);

export function GoogleSignInProvider({
	enabled,
	children,
}: {
	enabled: boolean;
	children: ReactNode;
}) {
	return <GoogleSignInContext value={enabled}>{children}</GoogleSignInContext>;
}

export function useGoogleSignIn(): boolean {
	return useContext(GoogleSignInContext);
}
