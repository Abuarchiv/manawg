'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useTranslations } from 'next-intl';
import { type ComponentProps, useEffect, useState } from 'react';

export type SocialProvider = 'google';

type SocialLoginStart = (provider: SocialProvider, next: string) => Promise<void> | void;

type SocialLoginButtonsProps = {
	next?: string;
	onOAuthStart: SocialLoginStart;
	variant?: 'sign-in' | 'sign-up' | 'link';
	/** Locks the button while another sign-in request is running. */
	disabled?: boolean;
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

const VARIANT_LABEL = { link: 'link', 'sign-up': 'signUp', 'sign-in': 'signIn' } as const;

const providers = [{ provider: 'google' as const, name: 'Google', Icon: GoogleG }];

export function SocialLoginButtons({
	next = '/',
	onOAuthStart,
	variant = 'sign-in',
	disabled = false,
}: SocialLoginButtonsProps) {
	const t = useTranslations('auth.social');
	const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pendingLabel = providers.find(({ provider }) => provider === pendingProvider)?.name;

	// Coming back from the provider via the bfcache restores this page with the spinner still on.
	useEffect(() => {
		const reset = (event: PageTransitionEvent) => {
			if (event.persisted) setPendingProvider(null);
		};
		window.addEventListener('pageshow', reset);
		return () => window.removeEventListener('pageshow', reset);
	}, []);

	async function start(provider: SocialProvider): Promise<void> {
		if (pendingProvider) return;

		setError(null);
		setPendingProvider(provider);
		try {
			await onOAuthStart(provider, next);
		} catch (error) {
			if (
				variant === 'link' &&
				error instanceof Error &&
				typeof Reflect.get(error, 'code') === 'string'
			) {
				// When linking, Supabase answers with an error code (e.g. already linked);
				// that is not a connection problem.
				setError(t('linkFailed'));
			} else {
				setError(t('unreachable'));
			}
			// On success the browser is already navigating away: keep the spinner until it does.
			setPendingProvider(null);
		}
	}

	return (
		<FieldSet
			aria-label={t(VARIANT_LABEL[variant], { provider: 'Google' })}
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
					{t(variant === 'link' ? 'pendingLink' : 'pendingSignIn', {
						provider: pendingLabel ?? '',
					})}
				</output>
			)}

			{providers.map(({ provider, name, Icon }) => {
				const loading = pendingProvider === provider;
				const label = t(VARIANT_LABEL[variant], { provider: name });
				return (
					<Button
						key={provider}
						type="button"
						variant="outline"
						onClick={() => void start(provider)}
						disabled={disabled || pendingProvider !== null}
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
