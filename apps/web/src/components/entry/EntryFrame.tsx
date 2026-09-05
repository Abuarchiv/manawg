import { buttonVariants } from '@/components/ui/button';
import { LogoMark } from '@/shared/components/ui/LogoMark';
import { cn } from '@/shared/lib/cn';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function EntryFrame({
	title,
	description,
	backHref = '/',
	headingId,
	actions,
	children,
}: {
	title: string;
	description: string;
	backHref?: string;
	headingId?: string;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<main
			id="main"
			tabIndex={-1}
			className="flex min-h-svh w-full flex-col gap-6 bg-background px-4 py-6 focus:outline-none"
			style={{
				paddingTop: 'calc(1.5rem + env(safe-area-inset-top, 0px))',
				paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))',
			}}
		>
			<div className="flex items-center justify-between gap-3">
				<Link
					href={backHref}
					aria-label="Zurück zur öffentlichen Ansicht"
					className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11')}
				>
					<ArrowLeft aria-hidden />
				</Link>
				<Link href={backHref} className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11')}>
					<LogoMark
						size={24}
						radius={6}
						tileFill="var(--primary)"
						markFill="var(--primary-foreground)"
					/>
					ManaWG
				</Link>
			</div>
			<header className="flex flex-col gap-2">
				<h1 id={headingId} className="text-2xl font-semibold tracking-tight">
					{title}
				</h1>
				<p className="text-sm text-muted-foreground">{description}</p>
				{actions}
			</header>
			{children}
			<footer className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
				<Link href={backHref} className={cn(buttonVariants({ variant: 'link' }), 'min-h-11 px-0')}>
					Öffentliche Ansicht
				</Link>
				<Link
					href="/datenschutz"
					className={cn(buttonVariants({ variant: 'link' }), 'min-h-11 px-0')}
				>
					Datenschutz
				</Link>
			</footer>
		</main>
	);
}
