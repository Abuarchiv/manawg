'use client';

import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from '@/components/animate-ui/primitives/base/collapsible';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	Field,
	FieldDescription,
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type ActionNotice, ActionNoticeBanner } from '@/components/wg/ActionNoticeBanner';
import { ImageUploader } from '@/components/wg/ImageUploader';
import type { Member } from '@/components/wg/WgContextProvider';
import { ArrowLeft, ChevronDown, Receipt, Repeat2 } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { ManualSplitSummary } from './ManualSplitSummary';
import { SplitReview } from './SplitReview';
import { TextField } from './TextField';
import { DESCRIPTION_MAX, RECURRING_INTERVAL_OPTIONS } from './constants';
import type { RecurringExpense } from './expense-types';
import type { SplitMode } from './useExpenseForm';

interface ExpenseFormSectionProps {
	description: string;
	setDescription: Dispatch<SetStateAction<string>>;
	amountStr: string;
	setAmountStr: Dispatch<SetStateAction<string>>;
	paidByMemberId: string;
	setPaidByMemberId: Dispatch<SetStateAction<string>>;
	members: Member[];
	payerOptions: Member[];
	splitCandidates: Member[];
	identityMemberId: string;
	splitMode: SplitMode;
	setSplitMode: Dispatch<SetStateAction<SplitMode>>;
	recurringIntervalMonths: number;
	setRecurringIntervalMonths: Dispatch<SetStateAction<number>>;
	manualSplits: Record<string, string>;
	setManualSplits: Dispatch<SetStateAction<Record<string, string>>>;
	imageUrl: string | null;
	setImageUrl: Dispatch<SetStateAction<string | null>>;
	shareCode: string;
	isEditingQueuedExpense: boolean;
	isEditingQueuedRecurring: boolean;
	formError: string | null;
	conflictExpenseId: string | null;
	onReloadServerVersion: () => void;
	onKeepDraft: () => void;
	savingRecurringTemplate: boolean;
	editingRecurringExpense: RecurringExpense | null;
	formSaving: boolean;
	onSaveRecurringTemplate: () => void;
	onCancel: () => void;
	onDiscard: () => void;
	title: string;
	previewSplits: Array<{ debtorMemberId: string; amountCents: number }> | null;
	pendingPrefillDescription: string | null;
	onReplacePrefill: () => void;
	isEditingExpense: boolean;
	notice: ActionNotice | null;
	onSubmit: () => void;
}

export function ExpenseFormSection({
	description,
	setDescription,
	amountStr,
	setAmountStr,
	paidByMemberId,
	setPaidByMemberId,
	members,
	payerOptions,
	splitCandidates,
	identityMemberId,
	splitMode,
	setSplitMode,
	recurringIntervalMonths,
	setRecurringIntervalMonths,
	manualSplits,
	setManualSplits,
	imageUrl,
	setImageUrl,
	shareCode,
	isEditingQueuedExpense,
	isEditingQueuedRecurring,
	formError,
	conflictExpenseId,
	onReloadServerVersion,
	onKeepDraft,
	savingRecurringTemplate,
	editingRecurringExpense,
	formSaving,
	onSaveRecurringTemplate,
	onCancel,
	onDiscard,
	onSubmit,
	title,
	previewSplits,
	pendingPrefillDescription,
	onReplacePrefill,
	isEditingExpense,
	notice,
}: ExpenseFormSectionProps): React.ReactElement {
	const [showRecurring, setShowRecurring] = useState(false);
	const [showReceipt, setShowReceipt] = useState(Boolean(imageUrl));
	const [confirmClose, setConfirmClose] = useState(false);
	const [replaceOpen, setReplaceOpen] = useState(false);
	const recurringOpen =
		showRecurring || editingRecurringExpense !== null || isEditingQueuedRecurring;
	function requestClose() {
		if (formSaving) return;
		if (description || amountStr || imageUrl || Object.values(manualSplits).some(Boolean))
			setConfirmClose(true);
		else onCancel();
	}

	return (
		<>
			<Dialog
				open
				onOpenChange={(open) => {
					if (!open) requestClose();
				}}
			>
				<DialogContent
					showCloseButton={false}
					className="top-0 flex h-dvh max-h-dvh w-full max-w-md translate-y-0 flex-col gap-0 rounded-none p-0 sm:max-w-md"
					initialFocus={false}
				>
					<DialogHeader className="shrink-0 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="icon"
								className="size-11"
								onClick={requestClose}
								disabled={formSaving}
								aria-label="Ausgabe abbrechen"
							>
								<ArrowLeft />
							</Button>
							<DialogTitle>{title}</DialogTitle>
						</div>
						<DialogDescription>
							Betrag, Zahler:in und Anteile prüfen. Speichern löst keine Überweisung aus.
						</DialogDescription>
					</DialogHeader>
					<Separator />
					<form
						className="flex min-h-0 flex-1 flex-col"
						onSubmit={(event) => {
							event.preventDefault();
							if (!formSaving) onSubmit();
						}}
					>
						<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
							<FieldGroup>
								{notice && <ActionNoticeBanner notice={notice} />}
								<p className="text-sm text-muted-foreground">
									{isEditingExpense
										? 'Änderungen werden erst beim Speichern für die WG übernommen.'
										: 'Die Ausgabe ist noch nicht gespeichert. Prüfe Betrag und Aufteilung.'}
								</p>
								{pendingPrefillDescription && (
									<Alert>
										<AlertDescription>Dein vorhandener Entwurf bleibt erhalten.</AlertDescription>
										<Button
											type="button"
											variant="outline"
											className="mt-3 h-auto min-h-11 w-full whitespace-normal"
											disabled={formSaving}
											onClick={() => setReplaceOpen(true)}
										>
											Entwurf verwerfen und „{pendingPrefillDescription}“ übernehmen
										</Button>
									</Alert>
								)}
								{(isEditingQueuedExpense || isEditingQueuedRecurring) && (
									<Alert>
										<AlertDescription>
											{isEditingQueuedRecurring
												? 'Wartende Fixkosten-Vorlage bearbeiten'
												: 'Wartende Ausgabe bearbeiten'}{' '}
											· noch nicht synchronisiert.
										</AlertDescription>
									</Alert>
								)}
								<TextField
									label="Beschreibung"
									value={description}
									onChange={setDescription}
									maxLength={DESCRIPTION_MAX}
									placeholder="z. B. Wocheneinkauf"
									disabled={formSaving}
								/>
								<TextField
									label="Betrag"
									value={amountStr}
									onChange={setAmountStr}
									inputMode="decimal"
									placeholder="0,00"
									suffix="€"
									disabled={formSaving}
								/>
								<Field data-disabled={formSaving}>
									<FieldLabel htmlFor="paid-by">Bezahlt von</FieldLabel>
									<NativeSelect
										id="paid-by"
										value={paidByMemberId}
										onChange={(event) => setPaidByMemberId(event.target.value)}
										disabled={formSaving}
										className="w-full [&_select]:h-11 [&_select]:text-base"
									>
										{payerOptions.map((member) => (
											<NativeSelectOption key={member.id} value={member.id}>
												{member.name}
												{member.id === identityMemberId ? ' (du)' : ''}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
								<FieldSet disabled={formSaving}>
									<FieldLegend>Beteiligte & Aufteilung</FieldLegend>
									<ToggleGroup
										value={[splitMode]}
										onValueChange={(values) => {
											const value = values[0];
											if (value === 'equal' || value === 'manual') setSplitMode(value);
										}}
										variant="outline"
										spacing={0}
										className="w-full"
										aria-label="Aufteilung"
									>
										<ToggleGroupItem
											value="equal"
											className="min-h-11 flex-1"
											aria-label="Aufteilung: Gleichmäßig"
										>
											Gleichmäßig
										</ToggleGroupItem>
										<ToggleGroupItem
											value="manual"
											className="min-h-11 flex-1"
											aria-label="Aufteilung: Manuell"
										>
											Manuell
										</ToggleGroupItem>
									</ToggleGroup>
									{splitMode === 'manual' && (
										<FieldGroup className="gap-3">
											{splitCandidates.map((member) => (
												<Field key={member.id} orientation="horizontal" data-disabled={formSaving}>
													<FieldLabel
														htmlFor={`share-${member.id}`}
														className="min-w-0 flex-1 break-words"
													>
														{member.name}
													</FieldLabel>
													<InputGroup className="min-h-11 w-32 shrink-0">
														<InputGroupInput
															id={`share-${member.id}`}
															type="text"
															inputMode="decimal"
															value={manualSplits[member.id] ?? ''}
															onChange={(event) =>
																setManualSplits((previous) => ({
																	...previous,
																	[member.id]: event.target.value,
																}))
															}
															placeholder="0,00"
															disabled={formSaving}
															aria-label={`Anteil ${member.name} in Euro`}
															className="min-h-11 text-base md:text-base"
														/>
														<InputGroupAddon align="inline-end">
															<InputGroupText>€</InputGroupText>
														</InputGroupAddon>
													</InputGroup>
												</Field>
											))}
											<ManualSplitSummary
												amountStr={amountStr}
												manualSplits={manualSplits}
												members={members}
												setManualSplits={setManualSplits}
												disabled={formSaving}
											/>
											<FieldDescription>
												Für einzelne Personen 0 € eintragen oder das Feld leer lassen.
											</FieldDescription>
										</FieldGroup>
									)}
									<SplitReview
										members={splitCandidates}
										splits={previewSplits}
										paidByMemberId={paidByMemberId}
									/>
								</FieldSet>
								<Separator />
								<Collapsible open={showReceipt} onOpenChange={setShowReceipt}>
									<CollapsibleTrigger
										render={
											<Button
												type="button"
												variant="ghost"
												className="min-h-11 w-full justify-start"
											/>
										}
										disabled={formSaving}
									>
										<Receipt data-icon="inline-start" />
										Beleg hinzufügen
										{imageUrl && <Badge variant="secondary">Angehängt</Badge>}
										<ChevronDown data-icon="inline-end" className="ml-auto" />
									</CollapsibleTrigger>
									<CollapsiblePanel>
										<div className="pt-3">
											<ImageUploader
												shareCode={shareCode}
												purpose="expense"
												value={imageUrl}
												onChange={setImageUrl}
												disabled={formSaving}
												imageLabel="Beleg"
											/>
										</div>
									</CollapsiblePanel>
								</Collapsible>
								<Collapsible open={recurringOpen} onOpenChange={setShowRecurring}>
									<CollapsibleTrigger
										render={
											<Button
												type="button"
												variant="ghost"
												className="min-h-11 w-full justify-start"
											/>
										}
										disabled={
											formSaving || editingRecurringExpense !== null || isEditingQueuedRecurring
										}
									>
										<Repeat2 data-icon="inline-start" />
										Fixkosten-Vorlage
										{recurringOpen && (
											<Badge variant="secondary">Alle {recurringIntervalMonths} Monate</Badge>
										)}
										<ChevronDown data-icon="inline-end" className="ml-auto" />
									</CollapsibleTrigger>
									<CollapsiblePanel>
										<FieldGroup className="pt-3">
											<Field>
												<FieldLabel htmlFor="expense-interval">Wiederholung</FieldLabel>
												<NativeSelect
													id="expense-interval"
													value={recurringIntervalMonths}
													onChange={(event) =>
														setRecurringIntervalMonths(Number(event.target.value))
													}
													disabled={formSaving}
													className="w-full [&_select]:h-11 [&_select]:text-base"
												>
													{RECURRING_INTERVAL_OPTIONS.map(({ value, label }) => (
														<NativeSelectOption key={value} value={value}>
															{label}
														</NativeSelectOption>
													))}
												</NativeSelect>
												<FieldDescription>
													Die Vorlage merkt Betrag, Zahler:in und diese Aufteilung.
												</FieldDescription>
											</Field>
											{!isEditingQueuedExpense &&
												!isEditingQueuedRecurring &&
												!editingRecurringExpense && (
													<Button
														type="button"
														variant="outline"
														className="min-h-11"
														onClick={onSaveRecurringTemplate}
														disabled={formSaving}
													>
														{savingRecurringTemplate && <Spinner data-icon="inline-start" />}Als
														Vorlage merken
													</Button>
												)}
										</FieldGroup>
									</CollapsiblePanel>
								</Collapsible>
								{formError && (
									<Alert variant="destructive">
										<AlertDescription>{formError}</AlertDescription>
										{conflictExpenseId && (
											<div className="flex flex-col gap-2 pt-3">
												<Button
													type="button"
													variant="outline"
													className="min-h-11"
													onClick={onReloadServerVersion}
												>
													Server-Version laden
												</Button>
												<Button
													type="button"
													variant="outline"
													className="min-h-11"
													onClick={onKeepDraft}
												>
													Meinen Entwurf behalten
												</Button>
											</div>
										)}
									</Alert>
								)}
							</FieldGroup>
						</div>
						<Separator />
						<div className="flex shrink-0 flex-col gap-2 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
							{editingRecurringExpense && !isEditingQueuedExpense && !isEditingQueuedRecurring && (
								<Button
									type="button"
									variant="outline"
									className="min-h-11"
									disabled={formSaving}
									onClick={onSaveRecurringTemplate}
								>
									{savingRecurringTemplate && <Spinner data-icon="inline-start" />}Vorlage speichern
								</Button>
							)}
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									className="min-h-11"
									onClick={requestClose}
									disabled={formSaving}
								>
									Abbrechen
								</Button>
								<Button
									type="submit"
									className="min-h-11 flex-1"
									disabled={formSaving}
									aria-label={
										isEditingQueuedRecurring ? 'Fixkosten-Vorlage speichern' : 'Ausgabe speichern'
									}
								>
									{formSaving && <Spinner data-icon="inline-start" />}
									{isEditingQueuedRecurring
										? 'Vorlage speichern'
										: editingRecurringExpense
											? 'Als Ausgabe speichern'
											: 'Speichern'}
								</Button>
							</div>
						</div>
					</form>
				</DialogContent>
			</Dialog>

			<AlertDialog open={replaceOpen} onOpenChange={setReplaceOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Entwurf verwerfen?</AlertDialogTitle>
						<AlertDialogDescription>
							Deine ungespeicherten Eingaben werden durch „{pendingPrefillDescription}“ ersetzt.
							Bereits gespeicherte Ausgaben bleiben erhalten.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter className="flex-col sm:flex-col">
						<AlertDialogCancel className="min-h-11">Entwurf behalten</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							onClick={onReplacePrefill}
						>
							Entwurf verwerfen
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Entwurf behalten?</AlertDialogTitle>
						<AlertDialogDescription>
							Es wird keine Ausgabe gespeichert. Du kannst deinen Entwurf später weiterbearbeiten
							oder ausdrücklich verwerfen.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter className="flex-col sm:flex-col">
						<AlertDialogCancel className="min-h-11">Weiterbearbeiten</AlertDialogCancel>
						<AlertDialogAction variant="destructive" className="min-h-11" onClick={onDiscard}>
							Entwurf verwerfen
						</AlertDialogAction>
						<AlertDialogAction className="min-h-11" onClick={onCancel}>
							Entwurf behalten
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
