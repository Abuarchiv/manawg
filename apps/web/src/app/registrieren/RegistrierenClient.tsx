'use client';

import { CredentialsAuth } from '@/components/auth/CredentialsAuth';
import { SocialLoginButtons } from '@/components/auth/SocialLoginButtons';
import { useGoogleSignIn } from '@/components/auth/google-sign-in';
import { EntryFrame } from '@/components/entry/EntryFrame';
import { LegalLinks } from '@/components/entry/LegalLinks';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { authPageHref } from '@/core/auth/auth-intent';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

function describeIntent(intent: URLSearchParams): string {
	if (intent.get('next')?.startsWith('/einladung/'))
		return 'Erstelle dein Konto, um der Einladung zu folgen.';
	if (intent.get('action') === 'create')
		return 'Erstelle dein Konto, danach legst du deine neue WG an.';
	return 'Mit deinem Konto erstellst du eine WG oder trittst per Einladung bei.';
}

/** Registration page: Google or e-mail/password, then back into the `/neu` start flow. */
export function RegistrierenClient({ intentQuery }: { intentQuery: string }) {
	const router = useRouter();
	const [credentialsBusy, setCredentialsBusy] = useState(false);
	const googleSignIn = useGoogleSignIn();
	const intent = new URLSearchParams(intentQuery);
	const afterAuthPath = authPageHref('/neu', intentQuery);

	return (
		<EntryFrame
			title="Konto erstellen"
			headingId="signup-heading"
			description={describeIntent(intent)}
			backHref="/"
		>
			<FieldGroup>
				{googleSignIn && (
					<>
						<SocialLoginButtons
							variant="sign-up"
							next={afterAuthPath}
							onOAuthStart={async (provider, next) => {
								const { startSocialLogin } = await import('@/core/auth/client');
								await startSocialLogin(provider, next);
							}}
							disabled={credentialsBusy}
						/>
						<FieldSeparator>oder</FieldSeparator>
					</>
				)}
				<CredentialsAuth
					mode="sign-up"
					next={afterAuthPath}
					onAuthenticated={() => router.replace(afterAuthPath)}
					onBusyChange={setCredentialsBusy}
				/>
			</FieldGroup>
			<p className="text-sm text-muted-foreground">
				Du hast schon ein Konto?{' '}
				<Link
					href={authPageHref('/neu', intentQuery)}
					className="-my-3 inline-block py-3 font-medium text-foreground underline underline-offset-4"
				>
					Anmelden
				</Link>
			</p>
			<LegalLinks registration />
		</EntryFrame>
	);
}
