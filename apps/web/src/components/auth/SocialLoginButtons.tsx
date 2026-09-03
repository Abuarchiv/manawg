'use client';

import { Chrome, Loader2 } from 'lucide-react';
import { useState } from 'react';

export type SocialProvider = 'google';

export type SocialLoginStart = (provider: SocialProvider, next: string) => Promise<void> | void;

type SocialLoginButtonsProps = {
	next?: string;
	onOAuthStart: SocialLoginStart;
	variant?: 'sign-in' | 'link';
};

const providers = [{ provider: 'google' as const, name: 'Google', Icon: Chrome }];

export function SocialLoginButtons({
	next = '/',
	onOAuthStart,
	variant = 'sign-in',
}: SocialLoginButtonsProps) {
	const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	const action = variant === 'link' ? 'verknüpfen' : 'anmelden';
	const pendingLabel = providers.find(({ provider }) => provider === pendingProvider)?.name;

	async function start(provider: SocialProvider): Promise<void> {
		if (pendingProvider) return;

		setError(null);
		setPendingProvider(provider);
		try {
			await onOAuthStart(provider, next);
		} catch (error) {
			setError(
				error instanceof Error && error.message === 'provider_unavailable'
					? 'Dieser Anmeldedienst ist gerade nicht verfügbar. Bitte versuche es später erneut.'
					: 'Die Anmeldung ist gerade nicht erreichbar. Bitte prüfe deine Verbindung und versuche es erneut.',
			);
		} finally {
			setPendingProvider(null);
		}
	}

	return (
		<fieldset
			aria-label={variant === 'link' ? 'Social Login verknüpfen' : 'Mit Social Login anmelden'}
			aria-busy={pendingProvider !== null}
			className="m-0 grid w-full gap-3 border-0 p-0"
		>
			{error && (
				<p
					role="alert"
					className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[13px] text-[var(--danger)]"
				>
					{error}
				</p>
			)}

			{pendingProvider && (
				<output aria-live="polite" className="sr-only">
					{pendingLabel} wird zum {action} gestartet …
				</output>
			)}

			{providers.map(({ provider, name, Icon }) => {
				const loading = pendingProvider === provider;
				const label = variant === 'link' ? `${name} verknüpfen` : `Mit ${name} anmelden`;
				return (
					<button
						key={provider}
						type="button"
						onClick={() => void start(provider)}
						disabled={pendingProvider !== null}
						className="inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-[14px] font-medium text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{loading ? (
							<Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
						) : (
							<Icon className="h-5 w-5" aria-hidden="true" />
						)}
						<span>{label}</span>
					</button>
				);
			})}
		</fieldset>
	);
}
