'use client';

import type { WgSummary } from '@/components/wg/WgContextProvider';
import { LinkRow } from '@/components/wg/einstellungen/LinkRow';
import { OfflineQueueSection } from '@/components/wg/einstellungen/OfflineQueueSection';
import { Section } from '@/components/wg/einstellungen/Section';
import { exportErrorMessage, readResponseErrorCode } from '@/core/guards/settings-errors';
import type { ExportSectionKey, ExportSectionSummary } from '@/core/reads/export';
import type { StoredIdentity } from '@/shared/lib/identity';
import { memberAuthHeader } from '@/shared/lib/identity';
import { Download, Loader2, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

interface DataTabProps {
	wg: WgSummary;
	identity: StoredIdentity;
	exportSummary: ExportSectionSummary[];
	exportSummaryError: string | null;
}

export function DataTab({ wg, identity, exportSummary, exportSummaryError }: DataTabProps) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [exportError, setExportError] = useState<string | null>(null);
	const [exportMessage, setExportMessage] = useState<string | null>(null);
	const [exportPending, setExportPending] = useState<'json' | 'csv' | null>(null);
	const [csvExportSection, setCsvExportSection] = useState<ExportSectionKey>('expenses');
	const exportPendingRef = useRef(false);
	const csvExportLabel =
		exportSummary.find((item) => item.key === csvExportSection)?.label ?? 'CSV';

	async function downloadExport(format: 'json' | 'csv', section?: ExportSectionKey): Promise<void> {
		if (exportPendingRef.current) return;
		exportPendingRef.current = true;
		setExportError(null);
		setExportMessage(null);
		setExportPending(format);
		const csvSection = section ?? csvExportSection;
		try {
			const url =
				format === 'csv'
					? `/api/wg/${encodedShareCode}/export?format=csv&section=${encodeURIComponent(csvSection)}`
					: `/api/wg/${encodedShareCode}/export`;
			const res = await fetch(url, { headers: memberAuthHeader(identity.memberId) });
			if (!res.ok) {
				setExportError(exportErrorMessage(res.status, await readResponseErrorCode(res)));
				return;
			}
			const blob = await res.blob();
			const href = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = href;
			a.download = `${wg.shareCode}-${format === 'csv' ? `${csvSection}.csv` : 'export.json'}`;
			a.style.display = 'none';
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.setTimeout(() => window.URL.revokeObjectURL(href), 0);
			setExportMessage(
				format === 'csv'
					? `${exportSummary.find((item) => item.key === csvSection)?.label ?? 'CSV'}-Export gestartet. Die CSV-Datei wird im Browser-Download gespeichert.`
					: 'JSON-Export gestartet. Die Datei wird im Browser-Download gespeichert.',
			);
		} catch {
			setExportError(exportErrorMessage(0, 'Netzwerkfehler'));
		} finally {
			exportPendingRef.current = false;
			setExportPending(null);
		}
	}

	return (
		<>
			<Section title="Datenexport" hint="Backup und Transparenz für eure WG-Daten.">
				{exportSummary.length > 0 && (
					<div className="grid grid-cols-2 gap-2 border-b border-[var(--border)] p-3 text-[12px] text-[var(--text-3)] sm:grid-cols-5">
						{exportSummary.map((section) => (
							<div key={section.key} className="rounded-md bg-[var(--surface)] px-2 py-1.5">
								<span className="block font-medium text-[var(--text-1)]">{section.count}</span>
								{section.label}
							</div>
						))}
					</div>
				)}
				{exportSummaryError && (
					<output
						className="block border-b border-[var(--border)] px-4 py-2 text-[12.5px] text-[var(--text-3)]"
						aria-live="polite"
					>
						{exportSummaryError} Downloads sind trotzdem möglich.
					</output>
				)}
				<div className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr_auto]">
					<button
						type="button"
						onClick={() => void downloadExport('json')}
						disabled={exportPending !== null}
						aria-label={
							exportPending === 'json'
								? 'WG-Daten werden als JSON exportiert'
								: 'WG-Daten als JSON exportieren'
						}
						className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[13px] font-medium text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
					>
						{exportPending === 'json' ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : (
							<Download className="h-4 w-4" aria-hidden />
						)}
						JSON exportieren
					</button>
					<label className="grid gap-1 text-[12px] text-[var(--text-3)]">
						<span>CSV-Bereich</span>
						<select
							value={csvExportSection}
							disabled={exportPending !== null}
							onChange={(event) => setCsvExportSection(event.target.value as ExportSectionKey)}
							className="h-11 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[13px] font-medium text-[var(--text-1)] outline-none focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
						>
							{exportSummary.map((section) => (
								<option key={section.key} value={section.key}>
									{section.label}
								</option>
							))}
						</select>
					</label>
					<button
						type="button"
						onClick={() => void downloadExport('csv')}
						disabled={exportPending !== null}
						aria-label={
							exportPending === 'csv'
								? `${csvExportLabel} wird als CSV exportiert`
								: `${csvExportLabel} als CSV exportieren`
						}
						className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-base)] px-3 text-[13px] font-medium text-[var(--text-1)] transition-colors hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-60"
					>
						{exportPending === 'csv' ? (
							<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
						) : (
							<Download className="h-4 w-4" aria-hidden />
						)}
						CSV exportieren
					</button>
				</div>
				{exportMessage && (
					<output
						className="block px-4 pb-3 text-[12.5px] text-[var(--success-fg)]"
						aria-live="polite"
					>
						{exportMessage}
					</output>
				)}
				{exportError && (
					<p role="alert" className="px-4 pb-3 text-[12.5px] text-[var(--danger)]">
						{exportError}
					</p>
				)}
			</Section>

			<Section
				title="Aus Splitwise oder Splid importieren"
				hint="Übernehme bestehende Ausgaben per CSV-Export oder Screenshot. Namen werden automatisch zugeordnet."
			>
				<div className="p-4">
					<Link
						href={`${wgBaseHref}/import`}
						className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--accent-fg)] transition-opacity hover:opacity-90"
					>
						<Upload className="h-4 w-4" aria-hidden />
						Ausgaben importieren
					</Link>
				</div>
			</Section>

			<OfflineQueueSection shareCode={wg.shareCode} memberId={identity.memberId} />

			<Section title="Rechtliches">
				<ul className="divide-y divide-[var(--border)]">
					<LinkRow href="https://manawg.com/impressum" label="Impressum" external />
					<LinkRow href="/datenschutz" label="Datenschutz" />
					<LinkRow href="https://manawg.com/agb" label="AGB" external />
				</ul>
			</Section>
		</>
	);
}
