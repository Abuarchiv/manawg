'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { BusyAction } from './auth-form-shared';
import { EmailAuthForm, useEmailAuth } from './EmailAuthForm';
import { EmailCodeForm, useEmailCode } from './EmailCodeForm';
import { EmailSignUpForm, useEmailSignUp } from './EmailSignUpForm';

type CredentialsAuthProps = {
	/** Sign-in offers a mailed code or a password; registration is the password form only. */
	mode?: 'sign-in' | 'sign-up';
	next: string;
	onAuthenticated: () => void;
	/** Lets the parent lock sibling controls (Google) while a request runs. */
	onBusyChange?: (busy: boolean) => void;
};

export function CredentialsAuth({
	mode = 'sign-in',
	next,
	onAuthenticated,
	onBusyChange,
}: CredentialsAuthProps) {
	const [method, setMethod] = useState<'code' | 'password'>('code');
	const [busy, setBusy] = useState<BusyAction>(null);
	// The forms keep their input while the other tab is shown; the address is shared.
	const emailAuth = useEmailAuth({ next, busy, setBusy, onAuthenticated });
	const emailCode = useEmailCode({
		email: emailAuth.email,
		setEmail: emailAuth.setEmail,
		busy,
		setBusy,
		onAuthenticated,
	});
	const emailSignUp = useEmailSignUp({ next, busy, setBusy, onAuthenticated });

	const isBusy = busy !== null;
	useEffect(() => {
		onBusyChange?.(isBusy);
		return () => onBusyChange?.(false);
	}, [isBusy, onBusyChange]);

	if (mode === 'sign-up') {
		return (
			<section aria-label="Mit E-Mail registrieren" aria-busy={isBusy}>
				<EmailSignUpForm auth={emailSignUp} busy={busy} />
			</section>
		);
	}

	return (
		<Tabs
			value={method}
			onValueChange={(value) => setMethod(value === 'password' ? 'password' : 'code')}
			aria-busy={isBusy}
			className="gap-4"
		>
			<TabsList className="min-h-12 w-full">
				<TabsTrigger value="code" disabled={isBusy} className="min-h-11 flex-auto">
					Code per E-Mail
				</TabsTrigger>
				<TabsTrigger value="password" disabled={isBusy} className="min-h-11 flex-auto">
					Passwort
				</TabsTrigger>
			</TabsList>
			<TabsContent value="code" aria-label="Mit E-Mail-Code anmelden" tabIndex={-1}>
				<EmailCodeForm auth={emailCode} busy={busy} intentQuery={next.split('?')[1] ?? ''} />
			</TabsContent>
			<TabsContent value="password" aria-label="Mit Passwort anmelden" tabIndex={-1}>
				<EmailAuthForm auth={emailAuth} busy={busy} />
			</TabsContent>
		</Tabs>
	);
}
