'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Toggle } from '@/components/ui/toggle';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AnnouncementFilter } from '@/features/pinnwand/announcement-workflow';
import { Pin, Search, SlidersHorizontal } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { KIND_OPTIONS, STATUS_FILTERS } from './constants';

interface PinnwandFilterBarProps {
	filter: AnnouncementFilter;
	onFilterChange: Dispatch<SetStateAction<AnnouncementFilter>>;
}

export function PinnwandFilterBar({ filter, onFilterChange }: PinnwandFilterBarProps) {
	const [optionsOpen, setOptionsOpen] = useState(false);
	const activeOptions =
		Number(filter.kind !== 'all') +
		Number(Boolean(filter.ownership && filter.ownership !== 'all')) +
		Number(filter.pinnedOnly);

	return (
		<Collapsible open={optionsOpen} onOpenChange={setOptionsOpen} className="flex flex-col gap-3">
			<InputGroup>
				<InputGroupAddon>
					<Search aria-hidden />
				</InputGroupAddon>
				<InputGroupInput
					type="search"
					value={filter.query ?? ''}
					aria-label="Beiträge durchsuchen"
					placeholder="Beiträge durchsuchen"
					onChange={(event) =>
						onFilterChange((current) => ({ ...current, query: event.target.value }))
					}
					className="text-base"
				/>
			</InputGroup>
			<div className="flex flex-col gap-2">
				<ToggleGroup
					variant="segmented"
					value={[filter.status]}
					aria-label="Status filtern"
					className="w-full"
					onValueChange={(values) => {
						const status = STATUS_FILTERS.find((option) => option.value === values[0])?.value;
						if (status) onFilterChange((current) => ({ ...current, status }));
					}}
				>
					{STATUS_FILTERS.map((option) => (
						<ToggleGroupItem
							key={option.value}
							value={option.value}
							className="min-h-11 whitespace-nowrap"
						>
							{option.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<CollapsibleTrigger render={<Button variant="ghost" className="self-start" />}>
					<SlidersHorizontal data-icon="inline-start" aria-hidden /> Filter
					{activeOptions > 0 && <Badge variant="secondary">{activeOptions}</Badge>}
				</CollapsibleTrigger>
			</div>
			<CollapsiblePanel keepRendered inert={!optionsOpen}>
				<FieldGroup className="gap-3">
					<Field>
						<FieldLabel htmlFor="announcement-kind-filter">Beitragstyp</FieldLabel>
						<NativeSelect
							id="announcement-kind-filter"
							value={filter.kind}
							aria-label="Typ filtern"
							className="w-full [&_select]:min-h-11 [&_select]:text-base"
							onChange={(event) =>
								onFilterChange((current) => ({
									...current,
									kind: event.target.value as AnnouncementFilter['kind'],
								}))
							}
						>
							<NativeSelectOption value="all">Alle Typen</NativeSelectOption>
							{KIND_OPTIONS.map((option) => (
								<NativeSelectOption key={option.value} value={option.value}>
									{option.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
					<Field>
						<FieldLabel htmlFor="announcement-owner-filter">Verantwortlichkeit</FieldLabel>
						<NativeSelect
							id="announcement-owner-filter"
							value={filter.ownership ?? 'all'}
							aria-label="Verantwortlichkeit filtern"
							className="w-full [&_select]:min-h-11 [&_select]:text-base"
							onChange={(event) =>
								onFilterChange((current) => ({
									...current,
									ownership: event.target.value as NonNullable<AnnouncementFilter['ownership']>,
								}))
							}
						>
							<NativeSelectOption value="all">Alle Zuständigkeiten</NativeSelectOption>
							<NativeSelectOption value="mine">Von mir übernommen</NativeSelectOption>
							<NativeSelectOption value="untaken">Noch niemand</NativeSelectOption>
						</NativeSelect>
					</Field>
					<Toggle
						pressed={filter.pinnedOnly}
						onPressedChange={(pressed) =>
							onFilterChange((current) => ({ ...current, pinnedOnly: pressed }))
						}
						variant="outline"
						className="min-h-11 self-start"
					>
						<Pin data-icon="inline-start" aria-hidden /> Nur fixierte Beiträge
					</Toggle>
				</FieldGroup>
			</CollapsiblePanel>
		</Collapsible>
	);
}
