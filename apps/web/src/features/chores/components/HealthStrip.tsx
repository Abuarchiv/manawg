import { Badge } from '@/components/ui/badge';
import type { getChorePlanHealth } from '@/features/chores/chore-status';

export function HealthStrip({ health }: { health: ReturnType<typeof getChorePlanHealth> }) {
	return (
		<section aria-label="Putzplan-Status" className="flex flex-wrap gap-2">
			<Badge variant="outline">{health.dueToday} heute fällig</Badge>
			<Badge variant="outline">{health.gaps} offen</Badge>
			{health.escalated > 0 && <Badge variant="outline">{health.escalated} Klärung offen</Badge>}
		</section>
	);
}
