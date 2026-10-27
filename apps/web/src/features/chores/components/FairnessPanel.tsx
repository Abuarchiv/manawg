'use client';

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
import { pluralize } from '@/shared/lib/plural';
import { ChevronDown } from 'lucide-react';

const FAIRNESS_RULES = [
	'Wenigste Last zuerst, niemand direkt doppelt',
	'Nach Erledigung neu berechnet, Abwesende übersprungen',
];

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
	/** The own person is called "du" everywhere, not by their own name. */
	currentMemberId: string;
}) {
	const shares = members
		.map((member) => ({ ...member, count: monthCompletions[member.id] ?? 0 }))
		.filter((member) => member.count > 0)
		.sort((a, b) => b.count - a.count);
	const total = shares.reduce((sum, member) => sum + member.count, 0);
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					Diesen Monat
					{fairness.suggestedAssignee && (
						<span className="font-normal text-muted-foreground">
							{' · Neue Aufgabe am besten für: '}
							<span className="font-medium text-foreground">
								{fairness.suggestedAssignee.id === currentMemberId
									? 'du'
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
							<p className="text-sm text-muted-foreground">Noch nichts erledigt.</p>
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
											{member.id === currentMemberId ? 'Du' : member.name}:{' '}
											{Math.round((member.count / total) * 100)} % ({member.count})
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
							So wird verteilt
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
									<li key={rule}>{rule}</li>
								))}
							</ul>
							<ItemGroup className="gap-0 divide-y">
								{fairness.rows.map((row) => (
									<ItemEntry key={row.id} className="px-0">
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">
												{row.id === currentMemberId ? 'Du' : row.name}
											</ItemTitle>
											<ItemDescription className="line-clamp-none">
												{pluralize(row.assignedCount, 'Aufgabe', 'Aufgaben')}
												{row.openGapCount > 0 && ` · ${row.openGapCount} offen`}
											</ItemDescription>
										</ItemContent>
										{!row.available && <Badge variant="secondary">Abwesend</Badge>}
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
