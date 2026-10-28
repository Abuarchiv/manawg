'use client';

import { CredentialsAuth } from '@/components/auth/CredentialsAuth';
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { authPageHref } from '@/core/auth/auth-intent';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

function intentKey(intent: URLSearchParams): 'inviteIntent' | 'createIntent' | 'defaultIntent' {
	if (intent.get('next')?.startsWith('/einladung/')) return 'inviteIntent';
	if (intent.get('action') === 'create') return 'createIntent';
	return 'defaultIntent';
}

/** Registration page: Google or e-mail/password, then back into the `/neu` start flow. */
export function RegistrierenClient({ intentQuery }: { intentQuery: string }) {
	const t = useTranslations('entry');
	const router = useRouter();
	const [credentialsBusy, setCredentialsBusy] = useState(false);
	const intent = new URLSearchParams(intentQuery);
	const afterAuthPath = authPageHref('/neu', intentQuery);

	return (
		<EntryFrame
			title={t('register.title')}
			headingId="signup-heading"
			description={t(`register.${intentKey(intent)}`)}
			backHref="/"
		>
			<FieldGroup>
				<SocialLoginButtons
					variant="sign-up"
					next={afterAuthPath}
					onOAuthStart={async (provider, next) => {
						const { startSocialLogin } = await import('@/core/auth/client');
						await startSocialLogin(provider, next);
					}}
					disabled={credentialsBusy}
				/>
				<FieldSeparator>{t('start.or')}</FieldSeparator>
				<CredentialsAuth
					mode="sign-up"
					next={afterAuthPath}
					onAuthenticated={() => router.replace(afterAuthPath)}
					onBusyChange={setCredentialsBusy}
				/>
			</FieldGroup>
			<p className="text-sm text-muted-foreground">
				{t('register.hasAccount')}{' '}
				<Link
					href={authPageHref('/neu', intentQuery)}
					className="-my-3 inline-block py-3 font-medium text-foreground underline underline-offset-4"
				>
					{t('register.signIn')}
				</Link>
			</p>
			<LegalLinks registration />
		</EntryFrame>
	);
}
