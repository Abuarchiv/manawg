import type { SettlementSummary, SimplifiedDebt } from './debt-reduction';

export function getDebtOverview(
	debts: readonly SimplifiedDebt[],
	currentMemberId: string,
	summary?: SettlementSummary,
) {
	// An empty simplified result is authoritative: reciprocal debts can cancel out.
	const transfers = summary ? summary.simplified : debts;
	return {
		personal: transfers.filter(
			(debt) => debt.fromId === currentMemberId || debt.toId === currentMemberId,
		),
		others: transfers.filter(
			(debt) => debt.fromId !== currentMemberId && debt.toId !== currentMemberId,
		),
	};
}
