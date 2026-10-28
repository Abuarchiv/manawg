import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { authPageHref } from '@/core/auth/auth-intent';

/** Points signed-out visitors to the registration page, keeping their create/join intent. */
export function SignUpPrompt({ intentQuery }: { intentQuery: string }) {
	const t = useTranslations('auth.prompt');
	return (
		<p className="text-sm text-muted-foreground">
			{t('noAccount')}{' '}
			<Link
				href={authPageHref('/registrieren', intentQuery)}
				className="-my-3 inline-block py-3 font-medium text-foreground underline underline-offset-4"
			>
				{t('create')}
			</Link>
		</p>
	);
}
