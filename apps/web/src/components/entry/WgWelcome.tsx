import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/shared/lib/cn';
import Link from 'next/link';

export type WgWelcomeVariant = 'create' | 'invitation' | 'member';

type WgWelcomeProps =
	| { variant: 'create' }
	| { variant: 'invitation'; code: string }
	| { variant: 'member'; wgName: string };

export function WgWelcome(props: WgWelcomeProps) {
	if (props.variant === 'member') {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Willkommen in deiner WG</CardTitle>
					<CardDescription>{props.wgName}</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const invitation = props.variant === 'invitation';
	const actionHref = invitation
		? `/neu?code=${encodeURIComponent(props.code)}`
		: '/neu?action=create';

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{invitation ? 'Deine Einladung wartet' : 'Deine WG gemeinsam organisieren'}</h2>
				</CardTitle>
				<CardDescription>
					{invitation
						? 'Melde dich an, um dieser bestehenden WG beizutreten.'
						: 'Ausgaben, Einkauf, Putzen und Pinnwand an einem Ort.'}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-2">
				<Link href={actionHref} className={cn(buttonVariants(), 'min-h-11 w-full')}>
					{invitation ? 'Dieser WG beitreten' : 'WG erstellen'}
				</Link>
				<Link
					href={invitation ? actionHref : '/neu'}
					className={cn(buttonVariants({ variant: 'outline' }), 'min-h-11 w-full')}
				>
					Anmelden
				</Link>
			</CardContent>
		</Card>
	);
}
