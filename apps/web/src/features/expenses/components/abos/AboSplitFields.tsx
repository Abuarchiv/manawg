'use client';

import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from '@/components/ui/field';
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from '@/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { AboSplit, MemberOption } from '@/features/expenses/components/abos/abos-types';
import { SplitReview } from '@/features/expenses/components/ausgaben/SplitReview';
import type { AboSplitBuildError, SplitMode } from './abo-form-model';

interface AboSplitFieldsProps {
	submitting: boolean;
	splitMode: SplitMode;
	onSplitModeChange: (mode: SplitMode) => void;
	splitCandidates: MemberOption[];
	manualSplits: Record<string, string>;
	onManualSplitChange: (memberId: string, value: string) => void;
	splitError: string | null;
	splitPreview: AboSplit[] | AboSplitBuildError;
	paidByMemberId: string;
}

/** "Beteiligte & Aufteilung": equal split preview or one amount field per member. */
export function AboSplitFields({
	submitting,
	splitMode,
	onSplitModeChange,
	splitCandidates,
	manualSplits,
	onManualSplitChange,
	splitError,
	splitPreview,
	paidByMemberId,
}: AboSplitFieldsProps) {
	return (
		<FieldSet disabled={submitting} data-invalid={Boolean(splitError)}>
			<FieldLegend variant="label">Beteiligte & Aufteilung</FieldLegend>
			<ToggleGroup
				variant="segmented"
				value={[splitMode]}
				onValueChange={(values) => {
					const value = values[0];
					if (value === 'equal' || value === 'manual') onSplitModeChange(value);
				}}
				className="w-full"
				aria-label="Fixkosten-Aufteilung"
			>
				<ToggleGroupItem value="equal" className="flex-1">
					Gleichmäßig
				</ToggleGroupItem>
				<ToggleGroupItem value="manual" className="flex-1">
					Manuell
				</ToggleGroupItem>
			</ToggleGroup>
			{splitMode === 'manual' && (
				<FieldGroup className={splitError ? 'block space-y-3' : 'gap-3'}>
					{splitCandidates.map((member, index) => (
						<Field key={member.id} orientation="responsive">
							<FieldLabel htmlFor={`abo-share-${member.id}`} className="min-w-0 flex-1 break-words">
								{member.name}
							</FieldLabel>
							<InputGroup className="w-full min-w-32 shrink-0 @md/field-group:max-w-32">
								<InputGroupInput
									id={`abo-share-${member.id}`}
									type="text"
									inputMode="decimal"
									value={manualSplits[member.id] ?? ''}
									onChange={(event) => onManualSplitChange(member.id, event.target.value)}
									placeholder="0,00"
									enterKeyHint={index === splitCandidates.length - 1 ? 'done' : 'next'}
									aria-label={`Anteil ${member.name} in Euro`}
									disabled={submitting}
									aria-invalid={Boolean(splitError)}
									aria-describedby={splitError ? 'abo-splits-error' : undefined}
									className="min-h-11 font-mono tabular-nums text-base"
								/>
								<InputGroupAddon align="inline-end">
									<InputGroupText>€</InputGroupText>
								</InputGroupAddon>
							</InputGroup>
						</Field>
					))}
					<FieldDescription>Die Anteile müssen zusammen den Gesamtbetrag ergeben.</FieldDescription>
				</FieldGroup>
			)}
			{splitError && <FieldError id="abo-splits-error">{splitError}</FieldError>}
			{splitMode !== 'manual' &&
				(typeof splitPreview === 'string' ? (
					<FieldDescription>Betrag eingeben, dann wird gleichmäßig aufgeteilt.</FieldDescription>
				) : (
					<SplitReview
						members={splitCandidates}
						splits={splitPreview}
						paidByMemberId={paidByMemberId}
					/>
				))}
		</FieldSet>
	);
}
