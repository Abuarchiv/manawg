import { Pause } from 'lucide-react';

export function AboPausedBadge() {
	return (
		<span
			className="inline-flex items-center gap-1 rounded-full border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]"
			aria-label="Abo pausiert"
		>
			<Pause className="h-3 w-3" aria-hidden />
			Pausiert
		</span>
	);
}
