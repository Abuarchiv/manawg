'use client';

import { Checkbox } from '@/components/animate-ui/components/base/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import type { Ref } from 'react';
import { ImportMemberMapping } from './ImportMemberMapping';
import { ImportPreviewTable } from './ImportPreviewTable';
import { ImportStepHeading } from './ImportStepHeading';
import type { ImportWizardState } from './use-import-wizard';

interface StepProps {
	headingRef: Ref<HTMLHeadingElement>;
	wizard: ImportWizardState;
}

export function ImportMappingStep({ headingRef, wizard }: StepProps) {
	return (
		<section className="flex flex-col gap-4">
			<ImportStepHeading headingRef={headingRef}>Namen WG-Mitgliedern zuordnen</ImportStepHeading>
			<p className="text-sm text-muted-foreground">
				{wizard.conflicts.length > 0
					? 'Ordne die markierten Namen zu.'
					: 'Alle Namen automatisch erkannt. Bitte prüfen.'}
			</p>
			<ImportMemberMapping
				names={wizard.namesNeedingMapping}
				mapping={wizard.mapping}
				members={wizard.memberOptions}
				onChange={wizard.updateMapping}
				showErrors={wizard.mappingValidated}
			/>
			<div className="flex min-w-0 flex-wrap gap-2">
				<Button className="flex-1" onClick={wizard.continueFromMapping}>
					Weiter zur Vorschau
				</Button>
				<Button variant="outline" onClick={() => wizard.goTo('input')}>
					Zurück
				</Button>
			</div>
		</section>
	);
}

export function ImportPreviewStep({ headingRef, wizard }: StepProps) {
	const { busy, selectedCount } = wizard;
	if (!wizard.preview) return null;
	return (
		<section className="flex flex-col gap-4">
			<div className="flex items-center justify-between gap-2">
				<ImportStepHeading headingRef={headingRef}>Vorschau</ImportStepHeading>
				<Badge variant="secondary">{selectedCount} ausgewählt</Badge>
			</div>
			<p className="text-sm text-muted-foreground">
				Prüfe Beträge und Anteile. Nicht gewünschte Einträge abwählen.
			</p>
			<ImportPreviewTable
				expenses={wizard.preview.parsed}
				mapping={wizard.mapping}
				members={wizard.memberOptions}
				skipIndexes={wizard.skipIndexes}
				onToggleSkip={wizard.toggleSkip}
				disabled={busy}
			/>
			<FieldGroup>
				<Field orientation="horizontal" className="min-h-11 items-start" data-disabled={busy}>
					<Checkbox
						className="mt-0.5"
						id="import-duplicates"
						checked={wizard.skipDuplicates}
						onCheckedChange={(checked) => wizard.setSkipDuplicates(checked === true)}
						disabled={busy}
					/>
					<div className="flex flex-col gap-1">
						<FieldLabel htmlFor="import-duplicates">Duplikate überspringen</FieldLabel>
						<FieldDescription>
							Gleiches Datum, Beschreibung, Betrag und zahlende Person.
						</FieldDescription>
					</div>
				</Field>
			</FieldGroup>
			<div className="sticky bottom-[calc(var(--app-nav-height,5rem)+env(safe-area-inset-bottom))] flex min-w-0 flex-wrap gap-2 bg-background py-3">
				<Button
					className="flex-1"
					disabled={busy || selectedCount === 0}
					onClick={() => void wizard.submitCommit()}
				>
					{busy && <Spinner data-icon="inline-start" />}Importieren ({selectedCount})
				</Button>
				<Button variant="outline" disabled={busy} onClick={() => wizard.goTo('mapping')}>
					Zurück
				</Button>
			</div>
		</section>
	);
}
