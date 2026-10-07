import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import Link from 'next/link';

type WgWelcomeProps =
	| { variant: 'create'; outline?: boolean }
	| { variant: 'invitation'; code: string };

export function WgWelcome(props: WgWelcomeProps) {
	const invitation = props.variant === 'invitation';
	const actionHref = invitation
		? `/neu?code=${encodeURIComponent(props.code)}`
		: '/neu?action=create';

	return (
		<div className="flex flex-col gap-2">
			{invitation && <p className="text-sm text-muted-foreground">Deine Einladung ist bereit.</p>}
			<Link
				href={actionHref}
				className={cn(
					buttonVariants({ variant: !invitation && props.outline ? 'outline' : 'default' }),
					'w-full',
				)}
			>
				{invitation ? 'Dieser WG beitreten' : 'WG erstellen'}
			</Link>
		</div>
	);
}
