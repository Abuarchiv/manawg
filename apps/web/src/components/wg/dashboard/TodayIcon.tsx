import type { TodayImportantKind } from '@/core/reads/dashboard-insights';
import {
	AlertTriangle,
	ListChecks,
	type LucideIcon,
	Megaphone,
	Receipt,
	Sparkles,
} from 'lucide-react';

const ICONS: Record<TodayImportantKind, LucideIcon> = {
	chore: Sparkles,
	shopping: ListChecks,
	debt: Receipt,
	recurring: Receipt,
	absence: AlertTriangle,
	announcement: Megaphone,
};

export function TodayIcon({ kind }: { kind: TodayImportantKind }) {
	const Icon = ICONS[kind];
	return <Icon className="size-4 shrink-0" aria-hidden />;
}
