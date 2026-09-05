'use client';

import { Checkbox } from '@/components/animate-ui/components/base/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import type { ParsedExpense } from '@/features/expenses/import-parsers';
import { runOcrOnImage } from '@/features/expenses/ocr';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { ImportMemberMapping } from './ImportMemberMapping';
import { ImportPreviewTable } from './ImportPreviewTable';
import { ImportProgress } from './ImportProgress';
import { type ImportSourceKind, ImportSourcePicker } from './ImportSourcePicker';

type Step = 'source' | 'input' | 'mapping' | 'preview' | 'commit';

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface PreviewResponse {
	parsed: ParsedExpense[];
	payloadHash: string;
	memberMapping: Record<string, string | null>;
	conflicts: string[];
	members: Array<{ id: string; name: string }>;
}

interface CommitResponse {
	importId: string;
	inserted: number;
	skipped: number;
	errors: Array<{ index: number; reason: string }>;
}

function importActionErrorMessage(error: string): string {
	if (error === 'Netzwerkfehler' || error === 'Failed to fetch') {
		return 'Prüfe deine Verbindung und versuche es erneut.';
	}
	if (error === 'unexpected_error' || error === 'server_error' || error === 'db_error') {
		return 'Versuche es gleich erneut.';
	}
	if (error === 'not_a_member' || error === 'member_id_required' || error === 'member_id_invalid') {
		return 'Tritt der WG erneut bei.';
	}
	if (error === 'mapping_incomplete') {
		return 'Bitte ordne alle Namen einem WG-Mitglied zu.';
	}
	if (error === 'payload_changed') {
		return 'Erstelle die Vorschau neu und versuche es erneut.';
	}
	if (error === 'payload_too_large') {
		return 'Datei ist zu groß.';
	}
	if (error === 'invalid_body' || error === 'invalid_json') {
		return 'Die Importdaten konnten nicht verarbeitet werden.';
	}
	return 'Versuche es gleich erneut.';
}

function payloadKey(source: ImportSourceKind): 'splitwise_csv' | 'splid_csv' | 'ocr_text' {
	if (source === 'splitwise_csv') return 'splitwise_csv';
	if (source === 'splid_csv') return 'splid_csv';
	return 'ocr_text';
}

export function ImportWizard() {
	const { wg, members, identity } = useWg();
	const encodedCode = encodeURIComponent(wg.shareCode);
	const [step, setStep] = useState<Step>('source');
	const [source, setSource] = useState<ImportSourceKind | null>(null);
	const [rawPayload, setRawPayload] = useState('');
	const [ocrText, setOcrText] = useState('');
	const [ocrRunning, setOcrRunning] = useState(false);
	const [preview, setPreview] = useState<PreviewResponse | null>(null);
	const [mapping, setMapping] = useState<Record<string, string | null>>({});
	const [skipIndexes, setSkipIndexes] = useState<Set<number>>(new Set());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [commitState, setCommitState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
	const [commitResult, setCommitResult] = useState<CommitResponse | null>(null);
	const [skipDuplicates, setSkipDuplicates] = useState(true);
	const ocrRunIdRef = useRef(0);
	const router = useRouter();
	const [leaveOpen, setLeaveOpen] = useState(false);
	const [sourceToChange, setSourceToChange] = useState<ImportSourceKind | null>(null);

	const conflicts = useMemo(() => preview?.conflicts ?? [], [preview]);
	// Import assigns expenses to a member ("aus Listen raus": moved-out members are
	// not offered as targets). Historic names in the CSV still resolve by name.
	const memberOptions = useMemo(
		() => members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })),
		[members],
	);
	const namesNeedingMapping = useMemo(() => {
		if (!preview) return [];
		const names = new Set<string>();
		for (const expense of preview.parsed) {
			if (expense.paidByName) names.add(expense.paidByName);
			for (const s of expense.splits) {
				if (s.memberName) names.add(s.memberName);
			}
		}
		return Array.from(names);
	}, [preview]);

	function resetImportState(): void {
		ocrRunIdRef.current += 1;
		setRawPayload('');
		setOcrText('');
		setOcrRunning(false);
		setPreview(null);
		setMapping({});
		setSkipIndexes(new Set());
		setBusy(false);
		setError(null);
		setCommitState('idle');
		setCommitResult(null);
		setSkipDuplicates(true);
	}

	async function handleOcrFile(file: File): Promise<void> {
		const runId = ocrRunIdRef.current + 1;
		ocrRunIdRef.current = runId;
		if (file.size > MAX_IMAGE_BYTES) {
			setError('Bild ist zu groß (max. 10 MB).');
			setOcrRunning(false);
			return;
		}
		setError(null);
		setOcrRunning(true);
		try {
			const text = await runOcrOnImage(file);
			if (ocrRunIdRef.current !== runId) return;
			setOcrText(text);
			setRawPayload(text);
		} catch (err) {
			if (ocrRunIdRef.current !== runId) return;
			console.error('[ImportWizard] OCR failed', err);
			setError('Texterkennung fehlgeschlagen. Versuche es mit einem klareren Bild.');
		} finally {
			if (ocrRunIdRef.current === runId) {
				setOcrRunning(false);
			}
		}
	}

	async function submitPreview(): Promise<void> {
		if (!source) return;
		const payloadSize = new Blob([rawPayload]).size;
		const limit = source === 'ocr_screenshot' ? MAX_IMAGE_BYTES : MAX_CSV_BYTES;
		if (payloadSize > limit) {
			setError('Datei ist zu groß.');
			return;
		}
		setBusy(true);
		setError(null);
		const res = await apiFetch<PreviewResponse>(`/api/wg/${encodedCode}/imports/preview`, {
			method: 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({
				source: payloadKey(source),
				payload: rawPayload,
			}),
		});
		setBusy(false);
		if (!res.ok) {
			setError(`Vorschau fehlgeschlagen: ${importActionErrorMessage(res.error)}`);
			return;
		}
		setPreview(res.data);
		setMapping(res.data.memberMapping);
		setSkipIndexes(new Set());
		setStep('mapping');
	}

	async function submitCommit(): Promise<void> {
		if (!source || !preview) return;
		setBusy(true);
		setCommitState('pending');
		setError(null);
		const res = await apiFetch<CommitResponse>(`/api/wg/${encodedCode}/imports/commit`, {
			method: 'POST',
			memberId: identity.memberId,
			memberToken: identity.memberToken,
			body: JSON.stringify({
				source: payloadKey(source),
				payload: rawPayload,
				previewPayloadHash: preview.payloadHash,
				memberMapping: mapping,
				skipDuplicates,
				skipIndexes: Array.from(skipIndexes),
			}),
		});
		setBusy(false);
		if (!res.ok) {
			setCommitState('error');
			setError(`Import fehlgeschlagen: ${importActionErrorMessage(res.error)}`);
			return;
		}
		setCommitResult(res.data);
		setCommitState('done');
		setStep('commit');
	}

	function toggleSkip(index: number): void {
		const next = new Set(skipIndexes);
		if (next.has(index)) next.delete(index);
		else next.add(index);
		setSkipIndexes(next);
	}

	function updateMapping(name: string, memberId: string | null): void {
		setMapping((prev) => ({ ...prev, [name]: memberId }));
	}

	const allMapped = namesNeedingMapping.every((name) => Boolean(mapping[name]));

	const stepNumber = ['source', 'input', 'mapping', 'preview', 'commit'].indexOf(step) + 1;
	const selectedCount = (preview?.parsed.length ?? 0) - skipIndexes.size;
	const returnHref = `/wg/${encodedCode}/einstellungen#daten`;
	function chooseSource(value: ImportSourceKind) {
		if (value !== source) resetImportState();
		setSource(value);
		setStep('input');
		setError(null);
	}

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center justify-between gap-2">
				<Link
					href={returnHref}
					className={buttonVariants({ variant: 'ghost', className: 'min-h-11' })}
					aria-disabled={busy || ocrRunning || undefined}
					tabIndex={busy || ocrRunning ? -1 : undefined}
					onClick={(event) => {
						if (busy || ocrRunning) {
							event.preventDefault();
							return;
						}
						if (rawPayload && commitState !== 'done') {
							event.preventDefault();
							setLeaveOpen(true);
						}
					}}
				>
					<ArrowLeft data-icon="inline-start" />
					Einstellungen
				</Link>
				<Badge variant="secondary">Schritt {stepNumber} von 5</Badge>
			</div>
			<Progress value={stepNumber} max={5} aria-label={`Import: Schritt ${stepNumber} von 5`} />
			{step === 'source' && (
				<section className="flex flex-col gap-3">
					<ImportSourcePicker
						value={source}
						onChange={(value) => {
							if (value !== source && rawPayload) setSourceToChange(value);
							else chooseSource(value);
						}}
					/>
				</section>
			)}
			{step === 'input' && source && (
				<section className="flex flex-col gap-4">
					<h2 className="text-base font-semibold">
						{source === 'ocr_screenshot' ? 'Screenshot hochladen' : 'CSV einfügen oder hochladen'}
					</h2>
					<FieldGroup>
						{source === 'ocr_screenshot' ? (
							<>
								<Field data-disabled={busy || ocrRunning}>
									<FieldLabel htmlFor="import-screenshot">Screenshot</FieldLabel>
									<Input
										id="import-screenshot"
										type="file"
										accept="image/*"
										aria-label="Screenshot auswählen"
										disabled={busy || ocrRunning}
										onChange={(event) => {
											const file = event.target.files?.[0];
											if (file) void handleOcrFile(file);
										}}
										className="min-h-11 text-base md:text-base"
									/>
									<FieldDescription>
										Bild bis 10 MB. Die Erkennung speichert keine Ausgabe.
									</FieldDescription>
								</Field>
								{ocrRunning && (
									<Alert>
										<Spinner />
										<AlertDescription>
											Texterkennung läuft. Das kann 30 Sekunden dauern.
										</AlertDescription>
									</Alert>
								)}
								<Field data-disabled={busy || ocrRunning}>
									<FieldLabel htmlFor="import-ocr">Erkannter Text</FieldLabel>
									<Textarea
										id="import-ocr"
										value={ocrText}
										onChange={(event) => {
											setOcrText(event.target.value);
											setRawPayload(event.target.value);
										}}
										disabled={busy || ocrRunning}
										aria-label="Erkannter Text"
										placeholder="Erkannten Text hier prüfen und korrigieren"
										className="min-h-48 text-base md:text-base"
									/>
								</Field>
							</>
						) : (
							<>
								<Field data-disabled={busy}>
									<FieldLabel htmlFor="import-csv-file">CSV-Datei</FieldLabel>
									<Input
										id="import-csv-file"
										type="file"
										accept=".csv,text/csv"
										aria-label="CSV-Datei auswählen"
										disabled={busy}
										className="min-h-11 text-base md:text-base"
										onChange={(event) => {
											const file = event.target.files?.[0];
											if (!file) return;
											if (file.size > MAX_CSV_BYTES) {
												setError('CSV ist zu groß (max. 5 MB).');
												return;
											}
											void file
												.text()
												.then(setRawPayload)
												.catch(() =>
													setError('CSV konnte nicht gelesen werden. Wähle die Datei erneut.'),
												);
										}}
									/>
									<FieldDescription>CSV bis 5 MB.</FieldDescription>
								</Field>
								<Field data-invalid={error !== null} data-disabled={busy}>
									<FieldLabel htmlFor="import-csv-textarea">CSV-Inhalt</FieldLabel>
									<Textarea
										id="import-csv-textarea"
										value={rawPayload}
										onChange={(event) => setRawPayload(event.target.value)}
										placeholder="…oder CSV-Inhalt hier einfügen"
										aria-label="CSV-Inhalt"
										aria-invalid={error !== null}
										aria-describedby={error ? 'import-error' : undefined}
										disabled={busy}
										className="min-h-48 text-base md:text-base"
									/>
								</Field>
							</>
						)}
					</FieldGroup>
					<div className="flex gap-2">
						<Button
							variant="outline"
							className="min-h-11"
							disabled={busy || ocrRunning}
							onClick={() => setStep('source')}
						>
							Zurück
						</Button>
						<Button
							className="min-h-11 flex-1"
							disabled={busy || ocrRunning || rawPayload.trim().length === 0}
							onClick={() => void submitPreview()}
						>
							{busy && <Spinner data-icon="inline-start" />}Vorschau erstellen
						</Button>
					</div>
				</section>
			)}
			{step === 'mapping' && preview && (
				<section className="flex flex-col gap-4">
					<h2 className="text-base font-semibold">Namen WG-Mitgliedern zuordnen</h2>
					<p className="text-sm text-muted-foreground">
						{conflicts.length > 0
							? 'Ordne die markierten Namen zu.'
							: 'Alle Namen automatisch erkannt. Bitte prüfen.'}
					</p>
					<ImportMemberMapping
						names={namesNeedingMapping}
						mapping={mapping}
						members={memberOptions}
						onChange={updateMapping}
					/>
					<div className="flex gap-2">
						<Button variant="outline" className="min-h-11" onClick={() => setStep('input')}>
							Zurück
						</Button>
						<Button
							className="min-h-11 flex-1"
							disabled={!allMapped}
							onClick={() => setStep('preview')}
						>
							Weiter zur Vorschau
						</Button>
					</div>
				</section>
			)}
			{step === 'preview' && preview && (
				<section className="flex flex-col gap-4">
					<div className="flex items-center justify-between gap-2">
						<h2 className="text-base font-semibold">Vorschau</h2>
						<Badge variant="secondary">{selectedCount} ausgewählt</Badge>
					</div>
					<p className="text-sm text-muted-foreground">
						Prüfe Betrag, Zahler:in und alle Anteile. Wähle Einträge ab, die du nicht übernehmen
						möchtest.
					</p>
					<ImportPreviewTable
						expenses={preview.parsed}
						mapping={mapping}
						members={memberOptions}
						skipIndexes={skipIndexes}
						onToggleSkip={toggleSkip}
						disabled={busy}
					/>
					<FieldGroup>
						<Field orientation="horizontal" data-disabled={busy}>
							<Checkbox
								id="import-duplicates"
								checked={skipDuplicates}
								onCheckedChange={(checked) => setSkipDuplicates(checked === true)}
								disabled={busy}
							/>
							<div className="flex flex-col gap-1">
								<FieldLabel htmlFor="import-duplicates">Duplikate überspringen</FieldLabel>
								<FieldDescription>
									Gleiches Datum, Beschreibung, Betrag und Zahler:in.
								</FieldDescription>
							</div>
						</Field>
					</FieldGroup>
					<div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] flex gap-2 bg-background py-3">
						<Button
							variant="outline"
							className="min-h-11"
							disabled={busy}
							onClick={() => setStep('mapping')}
						>
							Zurück
						</Button>
						<Button
							className="min-h-11 flex-1"
							disabled={busy || selectedCount === 0}
							onClick={() => void submitCommit()}
						>
							{busy && <Spinner data-icon="inline-start" />}Importieren ({selectedCount})
						</Button>
					</div>
				</section>
			)}
			{step === 'commit' && commitResult && (
				<section className="flex flex-col gap-4">
					<ImportProgress
						state="done"
						inserted={commitResult.inserted}
						skipped={commitResult.skipped}
						errors={commitResult.errors.length}
					/>
					{commitResult.errors.length > 0 && (
						<Alert variant="destructive">
							<AlertTitle>Nicht übernommene Einträge</AlertTitle>
							<AlertDescription>
								<ul className="flex flex-col gap-2">
									{commitResult.errors.map((item) => (
										<li key={item.index}>
											Eintrag {item.index + 1}: {importActionErrorMessage(item.reason)}
										</li>
									))}
								</ul>
							</AlertDescription>
						</Alert>
					)}
					<Link
						href={`/wg/${encodedCode}/ausgaben`}
						className={buttonVariants({ className: 'min-h-11' })}
					>
						Zu den Ausgaben
					</Link>
				</section>
			)}
			{commitState === 'pending' && <ImportProgress state="pending" />}
			{error && (
				<Alert id="import-error" variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			<AlertDialog
				open={leaveOpen || sourceToChange !== null}
				onOpenChange={(open) => {
					if (!open) {
						setLeaveOpen(false);
						setSourceToChange(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Import-Eingaben verwerfen?</AlertDialogTitle>
						<AlertDialogDescription>
							Die bisher eingegebenen Daten und Zuordnungen gehen verloren. Es werden keine neuen
							Ausgaben importiert.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="min-h-11">Weiterbearbeiten</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							className="min-h-11"
							onClick={() => {
								if (sourceToChange) {
									chooseSource(sourceToChange);
									setSourceToChange(null);
								} else router.push(returnHref);
							}}
						>
							Verwerfen
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
