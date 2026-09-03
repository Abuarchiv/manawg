import Link from 'next/link';

export type WgWelcomeVariant = 'create' | 'invitation' | 'member';

type WgWelcomeProps =
	| { variant: 'create' }
	| { variant: 'invitation'; code: string }
	| { variant: 'member'; wgName: string };

export function WgWelcome(props: WgWelcomeProps) {
	if (props.variant === 'member') {
		return (
			<section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
				<h2 className="text-base font-semibold text-[var(--text-1)]">Willkommen in deiner WG</h2>
				<p className="mt-1 text-[15px] text-[var(--text-2)]">{props.wgName}</p>
			</section>
		);
	}

	const invitation = props.variant === 'invitation';
	const actionHref = invitation
		? `/neu?code=${encodeURIComponent(props.code)}`
		: '/neu?action=create';

	return (
		<section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5">
			<h2 className="text-base font-semibold text-[var(--text-1)]">
				{invitation ? 'Deine Einladung wartet' : 'Deine WG gemeinsam organisieren'}
			</h2>
			<p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">
				{invitation
					? 'Melde dich an, um dieser bestehenden WG beizutreten.'
					: 'Ausgaben, Einkauf, Putzen und Pinnwand an einem Ort.'}
			</p>
			<div className="mt-4 space-y-2">
				<Link
					href={actionHref}
					className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-[var(--text-1)] px-4 py-3 text-[14px] font-semibold text-[var(--bg-base)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					{invitation ? 'Dieser WG beitreten' : 'WG erstellen'}
				</Link>
				<Link
					href={invitation ? actionHref : '/neu'}
					className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-[var(--border)] px-4 py-3 text-[14px] font-medium text-[var(--text-1)] transition-colors hover:bg-[var(--bg-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
				>
					Anmelden
				</Link>
			</div>
		</section>
	);
}
