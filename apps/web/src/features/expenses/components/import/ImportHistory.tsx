'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { useEffect, useState } from 'react';
import { ImportUndo } from './ImportUndo';

interface PastImport {
	id: string;
	source: string;
	startedAt: string;
	inserted: number;
	importedByMemberId: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
	splitwise_csv: 'Splitwise',
	splid_csv: 'Splid',
	ocr_screenshot: 'Screenshot',
};

const DAY_FORMATTER = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	timeZone: 'Europe/Berlin',
});

/** Earlier imports with their undo, for whoever ran them and for admins. */
export function ImportHistory() {
	const { wg, identity, members, isAdmin } = useWg();
	const [imports, setImports] = useState<PastImport[]>([]);
	const shareCode = wg.shareCode;
	const memberId = identity.memberId;

	useEffect(() => {
		let cancelled = false;
		void apiFetch<{ imports: PastImport[] }>(`/api/wg/${encodeURIComponent(shareCode)}/imports`, {
			memberId,
		}).then((res) => {
			if (!cancelled && res.ok) setImports(res.data.imports);
		});
		return () => {
			cancelled = true;
		};
	}, [shareCode, memberId]);

	if (imports.length === 0) return null;
	return (
		<section aria-labelledby="import-history-heading" className="flex flex-col gap-2">
			<h2 id="import-history-heading" className="font-heading text-sm font-semibold">
				Frühere Importe
			</h2>
			<ul className="flex flex-col divide-y rounded-xl border">
				{imports.map((item) => {
					const author = members.find((member) => member.id === item.importedByMemberId)?.name;
					const when = DAY_FORMATTER.format(new Date(item.startedAt));
					const description = `${SOURCE_LABELS[item.source] ?? 'Import'} vom ${when}`;
					const mayUndo = isAdmin || item.importedByMemberId === memberId;
					return (
						<li key={item.id} className="flex flex-col gap-2 p-3 text-sm">
							<span>
								{description}: {item.inserted} {item.inserted === 1 ? 'Ausgabe' : 'Ausgaben'}
								{author ? `, von ${author}` : ''}
							</span>
							{mayUndo && (
								<ImportUndo importId={item.id} label={`${description} rückgängig machen`} />
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
