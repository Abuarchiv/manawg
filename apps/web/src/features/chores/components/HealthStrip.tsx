import { Badge } from '@/components/ui/badge';
import type { getChorePlanHealth } from '@/features/chores/chore-status';

export function HealthStrip({ health }: { health: ReturnType<typeof getChorePlanHealth> }) {
	return (
		<section aria-label="Putzplan-Status" className="flex flex-wrap gap-2">
			<Badge variant="secondary">{health.total} Aufgaben</Badge>
			<Badge variant="outline">{health.dueToday} heute fällig</Badge>
			<Badge variant={health.gaps > 0 ? 'destructive' : 'outline'}>{health.gaps} Lücken</Badge>
			{health.escalated > 0 && <Badge variant="destructive">{health.escalated} zu klären</Badge>}
		</section>
	);
}
