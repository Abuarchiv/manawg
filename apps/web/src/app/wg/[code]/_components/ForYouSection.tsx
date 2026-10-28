'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { TodayImportantItem } from '@/composition/dashboard-insights';
import { Check, ChevronDown } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import type { HomeChoreCompletion } from '../_hooks/use-home-chore-completion';
import { TodayRow } from './TodayRow';

const TODAY_VISIBLE = 4;

interface ForYouSectionProps {
	items: TodayImportantItem[];
	/** The dashboard read has answered at least once. */
	loaded: boolean;
	failed: boolean;
	completion: HomeChoreCompletion;
}

export function ForYouSection({ items, loaded, failed, completion }: ForYouSectionProps) {
	const t = useTranslations('home.forYou');
	const [moreOpen, setMoreOpen] = useState(false);
	const reducedMotion = useReducedMotion();
	const visible = items.slice(0, TODAY_VISIBLE);
	const more = items.slice(TODAY_VISIBLE);

	// Once done, the row and its button disappear: move focus to the heading, otherwise it would fall back to body.
	const doneSeen = useRef(0);
	const needsFocus = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on a new completion and on a new list (after reload)
	useEffect(() => {
		if (completion.doneTick !== doneSeen.current) {
			doneSeen.current = completion.doneTick;
			needsFocus.current = true;
		}
		if (!needsFocus.current) return;
		const timer = setTimeout(() => {
			const active = document.activeElement;
			if (active && active !== document.body) return;
			needsFocus.current = false;
			document.getElementById('today-heading')?.focus({ preventScroll: true });
		}, 300);
		return () => clearTimeout(timer);
	}, [completion.doneTick, items]);

	const rows = (list: TodayImportantItem[]) =>
		list.map((item) => (
			<TodayRow
				key={`${item.kind}:${item.entityId ?? item.href}`}
				item={item}
				pending={completion.pendingChoreId === item.entityId}
				confirming={completion.confirmItem?.entityId === item.entityId}
				error={completion.completeError}
				onCheck={() => completion.arm(item)}
				onCancel={completion.cancel}
				onConfirm={() => void completion.confirm(item)}
			/>
		));

	return (
		<section aria-labelledby="today-heading" className="flex min-w-0 flex-col gap-2">
			<h2
				id="today-heading"
				tabIndex={-1}
				className="font-heading text-xl font-semibold outline-none"
			>
				{t('heading')}
			</h2>
			{loaded ? (
				items.length > 0 ? (
					<>
						<ul className="flex flex-col divide-y divide-border/60 rounded-xl border">
							{rows(visible)}
						</ul>
						{more.length > 0 && (
							<Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
								<CollapsibleTrigger
									render={
										<Button
											variant="ghost"
											className="w-full justify-between text-muted-foreground"
										/>
									}
								>
									<span>
										{moreOpen ? t('showLess') : t('showMore', { count: String(more.length) })}
									</span>
									<ChevronDown data-icon="inline-end" aria-hidden />
								</CollapsibleTrigger>
								<CollapsiblePanel {...(reducedMotion ? { transition: { duration: 0 } } : {})}>
									<ul className="mt-1 flex flex-col divide-y divide-border/60 rounded-xl border">
										{rows(more)}
									</ul>
								</CollapsiblePanel>
							</Collapsible>
						)}
					</>
				) : (
					<p className="flex items-center gap-2 rounded-xl border p-3 text-sm text-muted-foreground">
						<Check className="size-4 shrink-0" aria-hidden />
						{t('allDone')}
					</p>
				)
			) : failed ? (
				<p className="text-sm text-muted-foreground">{t('failed')}</p>
			) : (
				<output aria-label={t('loading')} className="flex flex-col gap-2">
					<Skeleton className="h-14 w-full bg-foreground/[0.07]" />
					<Skeleton className="h-14 w-full bg-foreground/[0.07]" />
				</output>
			)}
		</section>
	);
}
