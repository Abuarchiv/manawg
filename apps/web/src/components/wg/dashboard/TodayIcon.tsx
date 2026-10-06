import type { TodayImportantKind } from '@/composition/dashboard-insights';
import {
	AlertTriangle,
	ListChecks,
	type LucideIcon,
	Megaphone,
	Repeat2,
	Sparkles,
	Wallet,
} from 'lucide-react';

const ICONS: Record<TodayImportantKind, LucideIcon> = {
	chore: Sparkles,
	shopping: ListChecks,
	debt: Wallet,
	recurring: Repeat2,
	absence: AlertTriangle,
	announcement: Megaphone,
};

export function TodayIcon({ kind }: { kind: TodayImportantKind }) {
	const Icon = ICONS[kind];
	return <Icon className="size-4 shrink-0" aria-hidden />;
}
