import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { Plus } from 'lucide-react';
import type React from 'react';

interface EmptyStateProps {
	icon: React.ReactNode;
	headline: string;
	sub: string;
	cta?: {
		label: string;
		onClick: () => void;
		icon?: React.ReactNode;
	};
}

/** Compatibility API for the original empty-state callers. */
export function EmptyState({ icon, headline, sub, cta }: EmptyStateProps) {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">{icon}</EmptyMedia>
				<EmptyTitle>{headline}</EmptyTitle>
				<EmptyDescription>{sub}</EmptyDescription>
			</EmptyHeader>
			{cta !== undefined && (
				<EmptyContent>
					<Button
						type="button"
						onClick={cta.onClick}
						className="h-auto min-h-11 w-full whitespace-normal py-2"
					>
						{cta.icon ?? <Plus data-icon="inline-start" aria-hidden="true" />}
						{cta.label}
					</Button>
				</EmptyContent>
			)}
		</Empty>
	);
}
