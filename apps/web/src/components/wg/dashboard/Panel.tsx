import Link from 'next/link';
import type { ReactNode } from 'react';

interface PanelProps {
	title: string;
	linkHref?: string;
	children: ReactNode;
}

export function Panel({ title, linkHref, children }: PanelProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{title}</h2>
				</CardTitle>
				{linkHref && (
					<CardAction>
						<Link
							href={linkHref}
							aria-label={`${title} – alle ansehen`}
							className={cn(buttonVariants({ variant: 'ghost' }), 'min-h-11')}
						>
							Alle →
						</Link>
					</CardAction>
				)}
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}
import { buttonVariants } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/shared/lib/cn';
