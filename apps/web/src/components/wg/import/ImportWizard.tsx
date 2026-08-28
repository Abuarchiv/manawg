'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import type { ParsedExpense } from '@/lib/wg/import-parsers';
import { runOcrOnImage } from '@/lib/wg/ocr';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
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

	return (
		<div className="space-y-6">
			{step === 'source' && (
				<section>
					<h2 className="mb-2 text-[16px] font-semibold text-[var(--text-1)]">Quelle wählen</h2>
					<p className="mb-4 text-[12.5px] text-[var(--text-3)]">
						Wähle, woher die alten Ausgaben kommen.
					</p>
					<ImportSourcePicker
						value={source}
						onChange={(value) => {
							if (value !== source) {
								resetImportState();
							}
							setSource(value);
							setStep('input');
							setError(null);
						}}
					/>
				</section>
			)}

			{step === 'input' && source && (
				<section>
					<h2 className="mb-2 text-[16px] font-semibold text-[var(--text-1)]">
						{source === 'ocr_screenshot' ? 'Screenshot hochladen' : 'CSV einfügen oder hochladen'}
					</h2>
					{source === 'ocr_screenshot' ? (
						<div className="space-y-3">
							<input
								type="file"
								accept="image/*"
								aria-label="Screenshot auswählen"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) void handleOcrFile(file);
								}}
								className="block w-full text-[13px]"
							/>
							{ocrRunning && (
								<div className="flex items-center gap-2 text-[12.5px] text-[var(--text-3)]">
									<Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Texterkennung läuft (kann
									30 Sekunden dauern)...
								</div>
							)}
							{ocrText && (
								<textarea
									value={ocrText}
									onChange={(e) => {
										setOcrText(e.target.value);
										setRawPayload(e.target.value);
									}}
									aria-label="Erkannter Text"
									className="block h-48 w-full resize-vertical rounded-md border border-[var(--border)] bg-[var(--bg-base)] p-3 font-mono text-[12px] text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
								/>
							)}
						</div>
					) : (
						<div className="space-y-3">
							<input
								type="file"
								accept=".csv,text/csv"
								aria-label="CSV-Datei auswählen"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (!file) return;
									if (file.size > MAX_CSV_BYTES) {
										setError('CSV ist zu groß (max. 5 MB).');
										return;
									}
									void file.text().then(setRawPayload);
								}}
								className="block w-full text-[13px]"
							/>
							<textarea
								id="import-csv-textarea"
								value={rawPayload}
								onChange={(e) => setRawPayload(e.target.value)}
								placeholder="...oder CSV-Inhalt hier einfügen"
								aria-label="CSV-Inhalt"
								aria-invalid={error !== null}
								aria-describedby={error ? 'import-error' : undefined}
								className="block h-48 w-full resize-vertical rounded-md border border-[var(--border)] bg-[var(--bg-base)] p-3 font-mono text-[12px] text-[var(--text-1)] outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
							/>
						</div>
					)}
					<div className="mt-4 flex gap-2">
						<button
							type="button"
							onClick={() => setStep('source')}
							className="h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-4 text-[13px] text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							Zurück
						</button>
						<button
							type="button"
							disabled={busy || rawPayload.trim().length === 0}
							onClick={() => void submitPreview()}
							className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
							Vorschau erstellen
						</button>
					</div>
				</section>
			)}

			{step === 'mapping' && preview && (
				<section>
					<h2 className="mb-2 text-[16px] font-semibold text-[var(--text-1)]">
						Namen WG-Mitgliedern zuordnen
					</h2>
					<p className="mb-3 text-[12.5px] text-[var(--text-3)]">
						{conflicts.length > 0
							? 'Ordne die markierten Namen einem WG-Mitglied zu.'
							: 'Alle Namen wurden automatisch erkannt. Bitte prüfen.'}
					</p>
					<ImportMemberMapping
						names={namesNeedingMapping}
						mapping={mapping}
						members={memberOptions}
						onChange={updateMapping}
					/>
					<div className="mt-4 flex gap-2">
						<button
							type="button"
							onClick={() => setStep('input')}
							className="h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-4 text-[13px] text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							Zurück
						</button>
						<button
							type="button"
							disabled={!allMapped}
							onClick={() => setStep('preview')}
							className="h-11 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							Weiter zur Vorschau
						</button>
					</div>
				</section>
			)}

			{step === 'preview' && preview && (
				<section>
					<h2 className="mb-2 text-[16px] font-semibold text-[var(--text-1)]">Vorschau</h2>
					<p className="mb-3 text-[12.5px] text-[var(--text-3)]">
						Hake Einträge ab oder ab, dann importieren.
					</p>
					<ImportPreviewTable
						expenses={preview.parsed}
						mapping={mapping}
						members={memberOptions}
						skipIndexes={skipIndexes}
						onToggleSkip={toggleSkip}
					/>
					<label className="mt-4 flex items-center gap-2 text-[12.5px] text-[var(--text-2)]">
						<input
							type="checkbox"
							checked={skipDuplicates}
							onChange={(e) => setSkipDuplicates(e.target.checked)}
						/>
						Duplikate (gleiches Datum/Beschreibung/Betrag/Zahler) überspringen
					</label>
					<div className="mt-4 flex gap-2">
						<button
							type="button"
							onClick={() => setStep('mapping')}
							className="h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-4 text-[13px] text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
						>
							Zurück
						</button>
						<button
							type="button"
							disabled={busy}
							onClick={() => void submitCommit()}
							className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:opacity-50"
						>
							{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
							Importieren
						</button>
					</div>
				</section>
			)}

			{step === 'commit' && commitResult && (
				<section>
					<ImportProgress
						state="done"
						inserted={commitResult.inserted}
						skipped={commitResult.skipped}
						errors={commitResult.errors.length}
					/>
					<div className="mt-4">
						<Link
							href={`/wg/${encodedCode}/ausgaben`}
							className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
						>
							Zu den Ausgaben
						</Link>
					</div>
				</section>
			)}

			{commitState === 'pending' && <ImportProgress state="pending" />}
			{error && (
				<p
					id="import-error"
					role="alert"
					className="rounded-md bg-[var(--danger)]/10 p-3 text-[13px] text-[var(--danger)]"
				>
					{error}
				</p>
			)}
		</div>
	);
}
