import { PasswordResetForm } from '@/components/auth/PasswordResetForm';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function PasswordResetPage() {
	const [cookieStore, user] = await Promise.all([cookies(), getAuthenticatedUserFromCookies()]);
	const recoveryRequested = Boolean(
		user && cookieStore.get('manawg_password_recovery')?.value === user.id,
	);

	return (
		<EntryFrame
			title="Passwort zurücksetzen"
			description="Lege ein neues Passwort für dein Konto fest."
			headingId="password-reset-heading"
			backHref="/neu"
		>
			<Card>
				<CardHeader>
					<CardTitle>
						<h2>Neues Passwort</h2>
					</CardTitle>
					<CardDescription>Mindestens sechs Zeichen.</CardDescription>
				</CardHeader>
				<CardContent>
					<PasswordResetForm recoveryRequested={recoveryRequested} />
				</CardContent>
			</Card>
		</EntryFrame>
	);
}
