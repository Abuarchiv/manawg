import { PasswordResetForm } from '@/components/auth/PasswordResetForm';
import { getAuthenticatedUserFromCookies } from '@/core/auth/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function PasswordResetPage() {
	const [cookieStore, user] = await Promise.all([cookies(), getAuthenticatedUserFromCookies()]);
	const recoveryRequested = cookieStore.get('manawg_password_recovery')?.value === user?.id;

	return (
		<main className="mx-auto flex min-h-screen w-full max-w-md items-center px-5 py-12">
			<section className="w-full space-y-6" aria-labelledby="password-reset-heading">
				<div className="space-y-2">
					<p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--text-3)]">
						ManaWG
					</p>
					<h1 id="password-reset-heading" className="text-2xl font-semibold text-[var(--text-1)]">
						Passwort zurücksetzen
					</h1>
					<p className="text-sm text-[var(--text-2)]">
						Lege ein neues Passwort für dein Konto fest.
					</p>
				</div>
				<PasswordResetForm recoveryRequested={recoveryRequested} />
			</section>
		</main>
	);
}
