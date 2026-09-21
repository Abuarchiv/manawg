'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import type { ChoreFairness } from '@/features/chores/chore-fairness';
import { ChevronDown } from 'lucide-react';

const FAIRNESS_RULES = [
	'Niemand direkt doppelt',
	'Wenigste Last zuerst',
	'Nach Erledigung neu berechnet',
	'Abwesenheiten überspringen, sobald hinterlegt',
];

export function FairnessPanel({ fairness }: { fairness: ChoreFairness }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Faire Rotation</CardTitle>
				<CardDescription>{fairness.insights[0]}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{fairness.suggestedAssignee && (
					<p className="text-sm">
						Vorschlag für die nächste Aufgabe:{' '}
						<span className="font-medium">{fairness.suggestedAssignee.name}</span>
					</p>
				)}
				<Collapsible>
					<CollapsibleTrigger
						render={<Button variant="outline" className="min-h-11 w-full break-normal" />}
					>
						<span className="min-w-0 flex-1 text-left break-normal whitespace-normal">
							Verteilung und Regeln
						</span>
						<ChevronDown data-icon="inline-end" aria-hidden />
					</CollapsibleTrigger>
					<CollapsiblePanel>
						<div className="flex flex-col gap-3 pt-3">
							<ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
								{FAIRNESS_RULES.map((rule) => (
									<li key={rule}>{rule}</li>
								))}
							</ul>
							<ItemGroup className="gap-2">
								{fairness.rows.map((row) => (
									<Item key={row.id} variant="outline">
										<ItemContent className="min-w-0">
											<ItemTitle className="line-clamp-none break-words">{row.name}</ItemTitle>
											<ItemDescription className="line-clamp-none">
												{row.assignedCount} Aufgabe{row.assignedCount === 1 ? '' : 'n'} ·{' '}
												{row.openGapCount}{' '}
												{row.openGapCount === 1 ? 'offener Termin' : 'offene Termine'} · Score{' '}
												{row.score}
											</ItemDescription>
										</ItemContent>
										{!row.available && <Badge variant="secondary">Abwesend</Badge>}
									</Item>
								))}
							</ItemGroup>
						</div>
					</CollapsiblePanel>
				</Collapsible>
			</CardContent>
		</Card>
	);
}
