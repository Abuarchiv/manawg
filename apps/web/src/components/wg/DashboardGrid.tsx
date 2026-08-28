'use client';

import { AbosCard } from '@/components/wg/AbosCard';
import { ImportCard } from '@/components/wg/ImportCard';
import { KalenderCard } from '@/components/wg/KalenderCard';
import { MahnungenCard } from '@/components/wg/MahnungenCard';
import { VorraeteCard } from '@/components/wg/VorraeteCard';

interface Props {
	shareCode: string;
	memberId: string;
	expenseCount: number;
}

export function DashboardGrid({ shareCode, memberId, expenseCount }: Props) {
	return (
		<section aria-label="Neue Module" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			<KalenderCard shareCode={shareCode} memberId={memberId} />
			<VorraeteCard shareCode={shareCode} memberId={memberId} />
			<AbosCard shareCode={shareCode} memberId={memberId} />
			<MahnungenCard shareCode={shareCode} memberId={memberId} />
			<ImportCard shareCode={shareCode} expenseCount={expenseCount} />
		</section>
	);
}
