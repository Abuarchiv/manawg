'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { type ComponentProps, useState } from 'react';

export type SocialProvider = 'google';

type SocialLoginStart = (provider: SocialProvider, next: string) => Promise<void> | void;

type SocialLoginButtonsProps = {
	next?: string;
	onOAuthStart: SocialLoginStart;
	variant?: 'sign-in' | 'link';
};

function GoogleG(props: ComponentProps<'svg'>) {
	return (
		<svg viewBox="0 0 48 48" role="presentation" {...props}>
			<path
				fill="#EA4335"
				d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
			/>
			<path
				fill="#4285F4"
				d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.2 7-17.6z"
			/>
			<path
				fill="#FBBC05"
				d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"
			/>
			<path
				fill="#34A853"
				d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
			/>
		</svg>
	);
}

const providers = [{ provider: 'google' as const, name: 'Google', Icon: GoogleG }];

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
			if (error instanceof Error && error.message === 'provider_unavailable') {
				setError(
					'Dieser Anmeldedienst ist gerade nicht verfügbar. Bitte versuche es später erneut.',
				);
			} else if (
				variant === 'link' &&
				error instanceof Error &&
				typeof Reflect.get(error, 'code') === 'string'
			) {
				// Supabase antwortet beim Verknüpfen mit einem Fehlercode (z. B. bereits verknüpft);
				// das ist kein Verbindungsproblem.
				setError('Das Konto konnte nicht verknüpft werden. Bitte versuche es später erneut.');
			} else {
				setError(
					'Die Anmeldung ist gerade nicht erreichbar. Bitte prüfe deine Verbindung und versuche es erneut.',
				);
			}
		} finally {
			setPendingProvider(null);
		}
	}

	return (
		<FieldSet
			aria-label={variant === 'link' ? 'Social Login verknüpfen' : 'Mit Social Login anmelden'}
			aria-busy={pendingProvider !== null}
			className="m-0 w-full gap-3 border-0 p-0"
		>
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
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
					<Button
						key={provider}
						type="button"
						variant="outline"
						onClick={() => void start(provider)}
						disabled={pendingProvider !== null}
						className="w-full"
					>
						{loading ? (
							<Spinner data-icon="inline-start" aria-hidden="true" />
						) : (
							<Icon data-icon="inline-start" aria-hidden="true" />
						)}
						<span>{label}</span>
					</Button>
				);
			})}
		</FieldSet>
	);
}
