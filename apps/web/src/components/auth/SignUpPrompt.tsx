import Link from 'next/link';
import { authPageHref } from '@/core/auth/auth-intent';

/** Points signed-out visitors to the registration page, keeping their create/join intent. */
export function SignUpPrompt({ intentQuery }: { intentQuery: string }) {
	return (
		<p className="text-sm text-muted-foreground">
			Noch kein Konto?{' '}
			<Link
				href={authPageHref('/registrieren', intentQuery)}
				className="-my-3 inline-block py-3 font-medium text-foreground underline underline-offset-4"
			>
				Konto erstellen
			</Link>
		</p>
	);
}
