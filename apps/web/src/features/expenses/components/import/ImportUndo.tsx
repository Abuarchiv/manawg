'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useWg } from '@/components/wg/WgContextProvider';
import { NETWORK_ERROR_CODE } from '@/core/http/error-codes';
import { apiFetch } from '@/core/infra/api-client';
import { pluralize } from '@/shared/lib/plural';
import { useRef, useState } from 'react';

const UNDO_ERRORS: Readonly<Record<string, string>> = {
	import_settled:
		'Einige Anteile dieses Imports sind schon bezahlt. Entferne die Ausgaben einzeln, wenn sie falsch sind.',
	paypal_payment_pending: 'Eine PayPal-Zahlung läuft noch. Versuche es danach erneut.',
	not_owner: 'Nur wer importiert hat oder ein Admin kann diesen Import rückgängig machen.',
	import_not_found: 'Dieser Import ist nicht mehr vorhanden.',
	[NETWORK_ERROR_CODE]: 'Prüfe deine Verbindung und versuche es erneut.',
};

function undoErrorMessage(error: string): string {
	return UNDO_ERRORS[error] ?? 'Der Import konnte nicht rückgängig gemacht werden.';
}

/** Takes back everything an import created. Needs a second tap, because it removes expenses. */
export function ImportUndo({ importId, label }: { importId: string; label?: string }) {
	const { wg, identity } = useWg();
	const [armed, setArmed] = useState(false);
	const [pending, setPending] = useState(false);
	// null: not undone yet; 'unknown': undone, but the first answer was lost so the count is not.
	const [removed, setRemoved] = useState<number | 'unknown' | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pendingRef = useRef(false);
	// An attempt that ended without an answer may still have deleted everything.
	const uncertainRef = useRef(false);

	async function undo(): Promise<void> {
		if (pendingRef.current) return;
		pendingRef.current = true;
		setPending(true);
		setError(null);
		try {
			const res = await apiFetch<{ removed: number }>(
				`/api/wg/${encodeURIComponent(wg.shareCode)}/imports/${encodeURIComponent(importId)}`,
				{ method: 'DELETE', memberId: identity.memberId },
			);
			if (res.ok) setRemoved(res.data.removed);
			else if (res.error === 'import_not_found' && uncertainRef.current) setRemoved('unknown');
			else {
				uncertainRef.current = res.status === 0 || res.status >= 500;
				setError(undoErrorMessage(res.error));
			}
		} finally {
			pendingRef.current = false;
			setPending(false);
			setArmed(false);
		}
	}

	if (removed !== null) {
		return (
			<Alert>
				<AlertDescription>
					<output>
						{removed === 'unknown'
							? 'Import rückgängig gemacht.'
							: `Import rückgängig gemacht: ${pluralize(removed, 'Ausgabe', 'Ausgaben')} entfernt.`}
					</output>
				</AlertDescription>
			</Alert>
		);
	}

	return (
		<div className="flex flex-col items-start gap-2">
			<Button
				type="button"
				variant={armed ? 'destructive' : 'outline'}
				className="min-h-11"
				disabled={pending}
				{...(label ? { 'aria-label': armed ? `${label}: wirklich entfernen` : label } : {})}
				onClick={() => (armed ? void undo() : setArmed(true))}
			>
				{pending && <Spinner aria-hidden />}
				{armed ? 'Wirklich alle importierten Ausgaben entfernen' : 'Import rückgängig machen'}
			</Button>
			{armed && !pending && (
				<Button type="button" variant="ghost" className="min-h-11" onClick={() => setArmed(false)}>
					Abbrechen
				</Button>
			)}
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
