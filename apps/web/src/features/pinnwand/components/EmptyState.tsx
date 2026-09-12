import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
	icon: Icon,
	hint,
	children,
}: { icon: LucideIcon; hint?: string; children: ReactNode }) {
	return (
		<Empty className="border border-dashed">
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
