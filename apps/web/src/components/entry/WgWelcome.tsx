import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { SignUpPrompt } from '@/components/auth/SignUpPrompt';
import { buttonVariants } from '@/components/ui/button';
import { invitePath } from '@/core/utils/invite-token';
import { cn } from '@/shared/lib/cn';

type WgWelcomeProps = (
	| { variant: 'create'; outline?: boolean }
	| { variant: 'invitation'; token: string }
) & {
	/** Signed-out visitors also get a way to register instead of only signing in. */
	guest?: boolean;
};

/** Tells the visitor an invitation is waiting; the WG name is only shown once signed in. */
export function InvitationNotice() {
	const t = useTranslations('entry.welcome');
	return <p className="text-sm">{t('invited')}</p>;
}

export function WgWelcome(props: WgWelcomeProps) {
	const t = useTranslations('entry.welcome');
	const invitation = props.variant === 'invitation';
	// Account first: a signed-out visitor registers, then creates or joins a WG from /neu.
	// Only an invitation keeps its intent through sign-in, so the link is not lost.
	const guestCreate = !invitation && props.guest === true;
	const actionHref = invitation
		? invitePath(props.token)
		: guestCreate
			? '/registrieren'
			: '/neu?action=create';

	return (
		<div className="flex flex-col gap-2">
			<Link
				href={actionHref}
				className={cn(
					buttonVariants({ variant: !invitation && props.outline ? 'outline' : 'default' }),
					'w-full',
				)}
			>
				{invitation ? t('acceptInvite') : guestCreate ? t('createAccount') : t('createFlat')}
			</Link>
			{guestCreate && <p className="text-sm text-muted-foreground">{t('afterAccount')}</p>}
			{props.guest && invitation && (
				<SignUpPrompt intentQuery={`next=${encodeURIComponent(invitePath(props.token))}`} />
			)}
		</div>
	);
}
