import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoMark } from '@/components/ui/LogoMark';

export function EntryFrame({
	title,
	description,
	backHref = '/',
	backLabel = 'ManaWG Startseite',
	headingId,
	actions,
	children,
}: {
	title: string;
	description?: string | undefined;
	backHref?: string;
	backLabel?: string;
	headingId?: string;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<main
			id="main"
			tabIndex={-1}
			className="flex min-h-svh w-full flex-col gap-6 bg-background px-4 py-3 focus:outline-none"
			style={{
				paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
				paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
			}}
		>
			<Link
				href={backHref}
				className="relative flex min-h-9 items-center gap-2 self-start after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']"
				aria-label={backLabel}
			>
				<LogoMark size={24} tile={false} aria-hidden />
				<span className="font-heading text-xl font-semibold tracking-[-0.03em]">ManaWG</span>
			</Link>
			<header className="flex flex-col gap-2">
				<h1
					id={headingId}
					tabIndex={headingId ? -1 : undefined}
					className="break-words font-heading text-lg leading-6 font-semibold tracking-tight focus:outline-none"
				>
					{title}
				</h1>
				{description && <p className="text-sm text-muted-foreground">{description}</p>}
				{actions}
			</header>
			{children}
		</main>
	);
}
