'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
	ItemContent,
	ItemDescription,
	ItemEntry,
	ItemGroup,
	ItemTitle,
} from '@/components/ui/item';
import type { ChoreFairness } from '@/features/chores/chore-fairness';
import type { MemberRef } from '@/shared/lib/member-types';

const FAIRNESS_RULES = ['leastLoad', 'recalculated'] as const;

/** Bar segment and legend dot share the shading so they can be matched. */
function segmentTint(index: number): string {
	return `color-mix(in oklab, var(--primary) ${Math.max(100 - index * 25, 20)}%, transparent)`;
}

export function FairnessPanel({
	fairness,
	monthCompletions,
	members,
	currentMemberId,
}: {
	fairness: ChoreFairness;
	monthCompletions: Record<string, number>;
	members: MemberRef[];
	/** The own person is called "you" everywhere, not by their own name. */
	currentMemberId: string;
}) {
	const t = useTranslations('chores.fairness');
	const shares = members
		.map((member) => ({ ...member, count: monthCompletions[member.id] ?? 0 }))
		.filter((member) => member.count > 0)
		.sort((a, b) => b.count - a.count);
	const total = shares.reduce((sum, member) => sum + member.count, 0);
	return (
		<Card>
			<CardHeader>
				<CardTitle role="heading" aria-level={2}>
					{t('thisMonth')}
					{fairness.suggestedAssignee && (
						<span className="font-normal text-muted-foreground">
							{` · ${t('bestFor')} `}
							<span className="font-medium text-foreground">
								{fairness.suggestedAssignee.id === currentMemberId
									? t('you')
									: fairness.suggestedAssignee.name}
							</span>
						</span>
					)}
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<div className="flex flex-col gap-2 empty:hidden">
					{total === 0 ? (
						!fairness.suggestedAssignee && (
							<p className="text-sm text-muted-foreground">{t('nothingDone')}</p>
						)
					) : (
						<>
							<div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-muted">
								{shares.map((member, index) => (
									<span
										key={member.id}
										className="h-full border-background border-r-2 last:border-r-0"
										style={{
											width: `${(member.count / total) * 100}%`,
											backgroundColor: segmentTint(index),
										}}
									/>
								))}
							</div>
							<ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
								{shares.map((member, index) => (
									<li key={member.id} className="flex items-center gap-1.5">
										<span
											aria-hidden
											className="size-2 shrink-0 rounded-full"
											style={{ backgroundColor: segmentTint(index) }}
										/>
										<span>
											{t('share', {
												name: member.id === currentMemberId ? t('youCapital') : member.name,
												percent: String(Math.round((member.count / total) * 100)),
												count: String(member.count),
											})}
										</span>
									</li>
								))}
							</ul>
						</>
					)}
				</div>
				<Collapsible>
					<CollapsibleTrigger
						render={
							<Button
								variant="ghost"
								size="sm"
								className="-mx-2.5 w-[calc(100%+1.25rem)] max-w-none break-normal"
							/>
						}
					>
						<span className="min-w-0 flex-1 text-left break-normal whitespace-normal">
							{t('howTitle')}
						</span>
						<ChevronDown
							data-icon="inline-end"
							aria-hidden
							className="transition-transform group-aria-expanded/button:rotate-180 motion-reduce:transition-none"
						/>
					</CollapsibleTrigger>
					<CollapsiblePanel>
						<div className="flex flex-col gap-3 pt-3">
							<ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
								{FAIRNESS_RULES.map((rule) => (
									<li key={rule}>{t(`rules.${rule}`)}</li>
								))}
							</ul>
							<ItemGroup className="gap-0 divide-y">
								{fairness.rows.map((row) => (
									<ItemEntry key={row.id} className="px-0">
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">
												{row.id === currentMemberId ? t('youCapital') : row.name}
											</ItemTitle>
											<ItemDescription className="line-clamp-none">
												{t('taskCount', { count: row.assignedCount })}
												{row.openGapCount > 0 &&
													` · ${t('openCount', { count: String(row.openGapCount) })}`}
											</ItemDescription>
										</ItemContent>
										{!row.available && <Badge variant="secondary">{t('away')}</Badge>}
									</ItemEntry>
								))}
							</ItemGroup>
						</div>
					</CollapsiblePanel>
				</Collapsible>
			</CardContent>
		</Card>
	);
}
