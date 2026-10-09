'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEffect, useState } from 'react';
import { EmailAuthForm, useEmailAuth } from './EmailAuthForm';
import { EmailSignUpForm, useEmailSignUp } from './EmailSignUpForm';
import { PhoneAuthForm, usePhoneAuth } from './PhoneAuthForm';
import type { BusyAction } from './auth-form-shared';

type CredentialsAuthProps = {
	/** Sign-in and registration share the tabs; only the e-mail form differs. */
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
	const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
	const [busy, setBusy] = useState<BusyAction>(null);
	// Offer SMS only where the Supabase project actually has it switched on.
	const [phoneEnabled, setPhoneEnabled] = useState(false);
	// Both forms keep their input while the other tab is shown.
	const emailAuth = useEmailAuth({ next, busy, setBusy, onAuthenticated });
	const emailSignUp = useEmailSignUp({ next, busy, setBusy, onAuthenticated });
	const phoneAuth = usePhoneAuth({ busy, setBusy, onAuthenticated });

	const isBusy = busy !== null;
	useEffect(() => {
		onBusyChange?.(isBusy);
		return () => onBusyChange?.(false);
	}, [isBusy, onBusyChange]);

	useEffect(() => {
		let active = true;
		import('@/core/auth/client')
			.then(({ isAuthProviderEnabled }) => isAuthProviderEnabled('phone'))
			.then((enabled) => {
				if (active) setPhoneEnabled(enabled);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	return (
		<Tabs
			value={phoneEnabled ? authMethod : 'email'}
			onValueChange={(value) => setAuthMethod(value === 'phone' ? 'phone' : 'email')}
			aria-busy={busy !== null}
			className="gap-4"
		>
			{phoneEnabled && (
				<TabsList className="min-h-12 w-full">
					<TabsTrigger value="email" disabled={busy !== null} className="min-h-11">
						E-Mail
					</TabsTrigger>
					<TabsTrigger value="phone" disabled={busy !== null} className="min-h-11">
						Telefon / SMS
					</TabsTrigger>
				</TabsList>
			)}
			<TabsContent
				value="email"
				aria-label={mode === 'sign-up' ? 'Mit E-Mail registrieren' : 'Mit E-Mail anmelden'}
				tabIndex={-1}
			>
				{mode === 'sign-up' ? (
					<EmailSignUpForm auth={emailSignUp} busy={busy} />
				) : (
					<EmailAuthForm auth={emailAuth} busy={busy} />
				)}
			</TabsContent>

			{phoneEnabled && (
				<TabsContent value="phone" aria-labelledby="phone-auth-heading" tabIndex={-1}>
					<PhoneAuthForm auth={phoneAuth} busy={busy} />
				</TabsContent>
			)}
		</Tabs>
	);
}
