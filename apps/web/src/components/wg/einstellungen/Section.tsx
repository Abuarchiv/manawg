import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SectionProps {
	id?: string;
	title: string;
	hint?: string;
	children: ReactNode;
}

export function Section({ id, title, hint, children }: SectionProps) {
	return (
		<section id={id} aria-label={title} className="scroll-mt-24">
			<Card className="overflow-hidden">
				<CardHeader>
					<CardTitle>{title}</CardTitle>
					{hint ? <CardDescription>{hint}</CardDescription> : null}
				</CardHeader>
				<CardContent className="p-0">
					<div className="border-border border-t">{children}</div>
				</CardContent>
			</Card>
		</section>
	);
}
