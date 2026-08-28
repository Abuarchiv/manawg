import type { getChorePlanHealth } from '@/features/chores/chore-status';

export function HealthStrip({ health }: { health: ReturnType<typeof getChorePlanHealth> }) {
	return (
		<section
			aria-label="Putzplan-Status"
			className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
		>
			<div className="text-[13px] font-medium text-[var(--text-1)]">{health.text}</div>
			<div className="mt-2 grid grid-cols-3 gap-2 text-[12px] text-[var(--text-3)]">
				<div>
					<span className="block text-[15px] font-semibold text-[var(--text-1)]">
						{health.total}
					</span>
					offen
				</div>
				<div>
					<span className="block text-[15px] font-semibold text-[var(--danger)]">
						{health.gaps}
					</span>
					Lücken
				</div>
				<div>
					<span className="block text-[15px] font-semibold text-[var(--accent)]">
						{health.escalated}
					</span>
					klären
				</div>
			</div>
		</section>
	);
}
