'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useEffect, useState } from 'react';
import { EmailAuthForm, useEmailAuth } from './EmailAuthForm';
import { PhoneAuthForm, usePhoneAuth } from './PhoneAuthForm';
import type { BusyAction } from './auth-form-shared';

type CredentialsAuthProps = {
	next: string;
	onAuthenticated: () => void;
};

export function CredentialsAuth({ next, onAuthenticated }: CredentialsAuthProps) {
	const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');
	const [busy, setBusy] = useState<BusyAction>(null);
	// Offer SMS only where the Supabase project actually has it switched on.
	const [phoneEnabled, setPhoneEnabled] = useState(false);
	// Both forms keep their input while the other tab is shown.
	const emailAuth = useEmailAuth({ next, busy, setBusy, onAuthenticated });
	const phoneAuth = usePhoneAuth({ busy, setBusy, onAuthenticated });

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
					<TabsTrigger value="phone" disabled={busy !== null} className="min-h-11 px-0">
						<span className="whitespace-nowrap">Telefon</span> / SMS
					</TabsTrigger>
				</TabsList>
			)}
			<TabsContent value="email" aria-label="Mit E-Mail anmelden" tabIndex={-1}>
				<EmailAuthForm auth={emailAuth} busy={busy} />
			</TabsContent>

			{phoneEnabled && (
				<TabsContent value="phone" aria-labelledby="phone-auth-heading" tabIndex={-1}>
					<PhoneAuthForm auth={phoneAuth} busy={busy} />
				</TabsContent>
			)}
		</Tabs>
	);
}
