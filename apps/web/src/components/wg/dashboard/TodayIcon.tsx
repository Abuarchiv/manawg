import type { TodayImportantKind } from '@/core/reads/dashboard-insights';
import { AlertTriangle, ListChecks, Megaphone, Receipt, Sparkles } from 'lucide-react';

export function TodayIcon({ kind }: { kind: TodayImportantKind }) {
	const Icon =
		kind === 'chore'
			? Sparkles
			: kind === 'shopping'
				? ListChecks
				: kind === 'debt'
					? Receipt
					: kind === 'recurring'
						? Receipt
						: kind === 'absence'
							? AlertTriangle
							: Megaphone;
	return <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--text-3)]" aria-hidden />;
}
