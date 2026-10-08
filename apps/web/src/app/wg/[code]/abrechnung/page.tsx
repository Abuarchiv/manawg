'use client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { BackLink } from '@/components/wg/BackLink';
import { LoadErrorBanner } from '@/components/wg/LoadErrorBanner';
import { useWg } from '@/components/wg/WgContextProvider';
import { getWgLoadErrorMessage } from '@/core/guards/load-errors';
import { useCachedFetch } from '@/core/hooks/useCachedFetch';
import type { Expense } from '@/features/expenses/components/ausgaben/expense-types';
import { MonthlyStatementDocument } from '@/features/expenses/components/statement/MonthlyStatementDocument';
import {
	berlinMonthKey,
	buildMonthlyStatement,
	shiftMonthKey,
} from '@/features/expenses/monthly-statement';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function AbrechnungPage() {
	const { wg, members, identity } = useWg();
	const router = useRouter();
	const searchParams = useSearchParams();
	const wgBaseHref = `/wg/${encodeURIComponent(wg.shareCode)}`;
	const currentMonth = berlinMonthKey(new Date());
	const param = searchParams.get('monat') ?? '';
	// Default is the last finished month, the one the statement e-mail points to.
	const monthKey =
		MONTH_PARAM.test(param) && param <= currentMonth ? param : shiftMonthKey(currentMonth, -1);

	const { data, error, isFetching, refresh } = useCachedFetch<{ expenses: Expense[] }>(
		`/api/wg/${encodeURIComponent(wg.shareCode)}/expenses`,
		{ memberId: identity.memberId },
	);
	const statement = useMemo(
		() => (data ? buildMonthlyStatement(data.expenses, members, monthKey) : null),
		[data, members, monthKey],
	);

	// Paper is light: print with light tokens even when the app runs dark.
	useEffect(() => {
		const root = document.documentElement;
		let wasDark = false;
		const before = () => {
			wasDark = root.classList.contains('dark');
			root.classList.remove('dark');
		};
		const after = () => {
			if (wasDark) root.classList.add('dark');
		};
		window.addEventListener('beforeprint', before);
		window.addEventListener('afterprint', after);
		return () => {
			window.removeEventListener('beforeprint', before);
			window.removeEventListener('afterprint', after);
		};
	}, []);

	function goTo(delta: number) {
		router.replace(`${wgBaseHref}/abrechnung?monat=${shiftMonthKey(monthKey, delta)}`, {
			scroll: false,
		});
	}

	return (
		<div className="mx-auto flex w-full max-w-[var(--app-frame-width)] flex-col gap-4 px-4 pt-2 pb-8 print:max-w-none print:p-0">
			<div className="flex items-center gap-1 print:hidden">
				<BackLink href={`${wgBaseHref}/ausgaben`} label="Ausgaben" />
				<Button variant="ghost" size="icon" aria-label="Vorheriger Monat" onClick={() => goTo(-1)}>
					<ChevronLeft aria-hidden />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					aria-label="Nächster Monat"
					disabled={monthKey >= currentMonth}
					onClick={() => goTo(1)}
				>
					<ChevronRight aria-hidden />
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="ml-auto"
					disabled={!statement}
					onClick={() => window.print()}
				>
					<Download aria-hidden />
					Als PDF
				</Button>
			</div>

			{error && !data && (
				<LoadErrorBanner
					message={getWgLoadErrorMessage('Ausgaben', error.status, error.error, {
						verb: 'konnten',
					})}
					onRetry={() => void refresh()}
					busy={isFetching}
					retryLabel="Erneut laden"
				/>
			)}
			{statement ? (
				<MonthlyStatementDocument
					statement={statement}
					wgName={wg.name}
					shareCode={wg.shareCode}
					viewerId={identity.memberId}
					viewerName={identity.name}
				/>
			) : (
				!error && (
					<div className="flex flex-col gap-4" aria-busy="true">
						<Skeleton className="h-24 w-full" />
						<Skeleton className="h-40 w-full" />
					</div>
				)
			)}
		</div>
	);
}
