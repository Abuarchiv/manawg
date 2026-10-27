'use client';

import { useWg } from '@/components/wg/WgContextProvider';
import { apiFetch } from '@/core/infra/api-client';
import { formatDayMonthYear } from '@/core/utils/time';
import { pluralize } from '@/shared/lib/plural';
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

/** Earlier imports with their undo, for whoever ran them and for admins. */
export function ImportHistory() {
	const { wg, identity, members, isAdmin } = useWg();
	const [imports, setImports] = useState<PastImport[]>([]);
	const [loadFailed, setLoadFailed] = useState(false);
	const shareCode = wg.shareCode;
	const memberId = identity.memberId;

	// The list depends on the role (an admin sees every import), so a role change loads it again.
	// biome-ignore lint/correctness/useExhaustiveDependencies: isAdmin only triggers the reload
	useEffect(() => {
		let cancelled = false;
		void apiFetch<{ imports: PastImport[] }>(`/api/wg/${encodeURIComponent(shareCode)}/imports`, {
			memberId,
		}).then((res) => {
			if (cancelled) return;
			setLoadFailed(!res.ok);
			if (res.ok) setImports(res.data.imports);
		});
		return () => {
			cancelled = true;
		};
	}, [shareCode, memberId, isAdmin]);

	if (loadFailed && imports.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">Frühere Importe konnten nicht geladen werden.</p>
		);
	}
	if (imports.length === 0) return null;
	return (
		<section aria-labelledby="import-history-heading" className="flex flex-col gap-2">
			<h2 id="import-history-heading" className="font-heading text-sm font-semibold">
				Frühere Importe
			</h2>
			<ul className="flex flex-col divide-y rounded-xl border">
				{imports.map((item) => {
					const author = members.find((member) => member.id === item.importedByMemberId)?.name;
					const when = formatDayMonthYear(item.startedAt);
					const description = `${SOURCE_LABELS[item.source] ?? 'Import'} vom ${when}`;
					const mayUndo = isAdmin || item.importedByMemberId === memberId;
					return (
						<li key={item.id} className="flex flex-col gap-2 p-3 text-sm">
							<span>
								{description}: {pluralize(item.inserted, 'Ausgabe', 'Ausgaben')}
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
