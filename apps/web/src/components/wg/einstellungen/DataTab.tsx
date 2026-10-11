'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import type { WgSummary } from '@/components/wg/WgContextProvider';
import { LinkRow } from '@/components/wg/einstellungen/LinkRow';
import { OfflineQueueSection } from '@/components/wg/einstellungen/OfflineQueueSection';
import { Section } from '@/components/wg/einstellungen/Section';
import {
	exportErrorMessage,
	readResponseErrorCode,
} from '@/components/wg/einstellungen/settings-errors';
import type { SessionMember } from '@/core/auth/local-account';
import { noteSessionExpiry } from '@/core/infra/api-client';
import { cn } from '@/shared/lib/cn';
import { memberContextHeader } from '@/shared/lib/member-header';
import { Download, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

/** One exportable section as the export summary lists it; `key` is the CSV `section` parameter. */
export interface ExportSectionOption {
	key: string;
	label: string;
	count: number;
}

interface DataTabProps {
	wg: WgSummary;
	identity: SessionMember;
	exportSummary: ExportSectionOption[];
	exportSummaryError: string | null;
}

export function DataTab({ wg, identity, exportSummary, exportSummaryError }: DataTabProps) {
	const encodedShareCode = encodeURIComponent(wg.shareCode);
	const wgBaseHref = `/wg/${encodedShareCode}`;
	const [exportError, setExportError] = useState<string | null>(null);
	const [exportMessage, setExportMessage] = useState<string | null>(null);
	const [exportPending, setExportPending] = useState<'json' | 'csv' | null>(null);
	const [csvExportSection, setCsvExportSection] = useState('expenses');
	const exportPendingRef = useRef(false);
	const csvExportLabel =
		exportSummary.find((item) => item.key === csvExportSection)?.label ?? 'CSV';

	async function downloadExport(format: 'json' | 'csv', section?: string): Promise<void> {
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
			const res = await fetch(url, { headers: memberContextHeader(identity.memberId) });
			noteSessionExpiry(res);
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
			<Section
				title="Datenexport"
				hint="Alle WG-Daten inklusive erledigter Zahlungen, ohne Dateianhänge."
			>
				{exportSummary.length > 0 && !exportSummaryError && (
					<div className="border-border grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-x-4 gap-y-1.5 border-b p-3 text-xs">
						{exportSummary.map((section) => (
							<div key={section.key} className="flex min-w-0 items-baseline gap-2">
								<span className="text-foreground font-mono font-medium tabular-nums">
									{section.count}
								</span>
								<span className="text-muted-foreground min-w-0 break-words">{section.label}</span>
							</div>
						))}
					</div>
				)}
				{exportSummaryError && (
					<p
						className="text-muted-foreground border-border block border-b p-3 text-xs"
						aria-live="polite"
					>
						{exportSummaryError} Downloads sind trotzdem möglich.
					</p>
				)}
				<div className="grid gap-2 p-3">
					<Button
						type="button"
						variant="outline"
						onClick={() => void downloadExport('json')}
						disabled={exportPending !== null}
						aria-label={
							exportPending === 'json'
								? 'WG-Daten werden als JSON exportiert'
								: 'WG-Daten als JSON exportieren'
						}
						className="h-11 w-full"
					>
						{exportPending === 'json' ? <Spinner aria-hidden /> : <Download aria-hidden />}
						JSON exportieren
					</Button>
					<div className="flex flex-wrap gap-2">
						<NativeSelect
							id="csv-export-section"
							aria-label="CSV-Bereich"
							value={csvExportSection}
							disabled={exportPending !== null}
							onChange={(event) => setCsvExportSection(event.target.value)}
							className="min-w-0 max-w-full flex-1 basis-36 text-base"
						>
							{exportSummary.map((section) => (
								<NativeSelectOption key={section.key} value={section.key}>
									{section.label}
								</NativeSelectOption>
							))}
						</NativeSelect>
						<Button
							type="button"
							variant="outline"
							onClick={() => void downloadExport('csv')}
							disabled={exportPending !== null}
							aria-label={
								exportPending === 'csv'
									? `${csvExportLabel} wird als CSV exportiert`
									: `${csvExportLabel} als CSV exportieren`
							}
							className="h-11 min-w-fit flex-1"
						>
							{exportPending === 'csv' ? <Spinner aria-hidden /> : <Download aria-hidden />}
							CSV exportieren
						</Button>
					</div>
				</div>
				{exportMessage && (
					<div className="p-3 pt-0">
						<Alert>
							<AlertDescription>{exportMessage}</AlertDescription>
						</Alert>
					</div>
				)}
				{exportError && (
					<div className="p-3 pt-0">
						<Alert variant="destructive">
							<AlertTitle>Export fehlgeschlagen</AlertTitle>
							<AlertDescription>{exportError}</AlertDescription>
						</Alert>
					</div>
				)}
			</Section>

			<Section title="Import">
				<div className="p-3">
					<Link
						href={`${wgBaseHref}/import`}
						className={cn(buttonVariants({ variant: 'outline' }), 'h-11 w-full')}
					>
						<Upload aria-hidden />
						Ausgaben importieren
					</Link>
				</div>
			</Section>

			<OfflineQueueSection shareCode={wg.shareCode} memberId={identity.memberId} />

			<Section title="Rechtliches">
				<ul className="divide-border divide-y">
					<LinkRow href="https://manawg.com/impressum" label="Impressum" external />
					<LinkRow href="https://manawg.com/datenschutz" label="Datenschutz" external />
					<LinkRow href="https://manawg.com/agb" label="AGB" external />
				</ul>
			</Section>
		</>
	);
}
