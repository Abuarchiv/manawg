import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
	icon: Icon,
	hint,
	children,
}: { icon: LucideIcon; hint?: string; children: ReactNode }) {
	return (
		<div className="flex items-start gap-3 py-4">
			<Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
			<div className="min-w-0 space-y-1">
				<p className="text-sm font-medium">{children}</p>
				{hint && <p className="text-sm text-muted-foreground">{hint}</p>}
			</div>
		</div>
	);
}
