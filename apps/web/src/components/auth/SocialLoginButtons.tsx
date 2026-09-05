'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Chrome } from 'lucide-react';
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
						size="lg"
						onClick={() => void start(provider)}
						disabled={pendingProvider !== null}
						className="min-h-11 w-full"
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
