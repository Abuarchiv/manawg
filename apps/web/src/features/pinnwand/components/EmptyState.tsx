import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';

export function EmptyState({
	icon: Icon,
	hint,
	children,
}: {
	icon: LucideIcon;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon aria-hidden />
				</EmptyMedia>
				<EmptyTitle>{children}</EmptyTitle>
				{hint && <EmptyDescription>{hint}</EmptyDescription>}
			</EmptyHeader>
		</Empty>
	);
}
