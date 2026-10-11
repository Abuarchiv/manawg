import { SignUpPrompt } from '@/components/auth/SignUpPrompt';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import Link from 'next/link';

type WgWelcomeProps = (
	| { variant: 'create'; outline?: boolean }
	| { variant: 'invitation'; code: string }
) & {
	/** Signed-out visitors also get a way to register instead of only signing in. */
	guest?: boolean;
};

/** Names the invitation (code only; the WG name is unknown before joining) above the example. */
export function InvitationNotice({ code }: { code: string }) {
	return (
		<p className="text-sm">
			Einladung zur WG, Code <span className="font-mono font-semibold tracking-wider">{code}</span>
		</p>
	);
}

export function WgWelcome(props: WgWelcomeProps) {
	const invitation = props.variant === 'invitation';
	// Account first: a signed-out visitor registers, then creates or joins a WG from /neu.
	// Only an invitation keeps its intent through sign-in, so the code is not lost.
	const guestCreate = !invitation && props.guest === true;
	const actionHref = invitation
		? `/neu?code=${encodeURIComponent(props.code)}`
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
				{invitation ? 'Einladung annehmen' : guestCreate ? 'Konto erstellen' : 'WG erstellen'}
			</Link>
			{guestCreate && (
				<p className="text-sm text-muted-foreground">
					Danach erstellst du eure WG oder trittst per Code bei.
				</p>
			)}
			{props.guest && invitation && (
				<SignUpPrompt intentQuery={`code=${encodeURIComponent(props.code)}`} />
			)}
		</div>
	);
}
