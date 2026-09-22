export function isPayPalCaptureDebtChanged(
	debtCents: number | undefined,
	captureAmountCents: number,
): boolean {
	// Fail-closed on exact match: a capture for the exact remaining debt is NOT
	// a changed debt — it is the expected settlement. Only a mismatch (debt
	// moved since the order was created) should block the capture.
	return debtCents === undefined || debtCents !== captureAmountCents;
}

export type PayPalCaptureResult =
	| { ok: true; data: { status: string } }
	| { ok: false; status: number; error?: string };

/**
 * Decide whether the PayPal capture retry loop should retry or stop.
 *
 * - 2xx with COMPLETED status: success, stop.
 * - 2xx with non-COMPLETED status: the order was retrieved but not yet
 *   completed (e.g. APPROVED, PAYER_APPROVAL_REQUIRED). Retry — the payer may
 *   still approve.
 * - 4xx (except 429): client error, stop. The request will never succeed
 *   without the caller changing something.
 * - 429 / 5xx: transient, retry.
 * - network failure (status 0): retry.
 */
export function shouldRetryPayPalCapture(result: PayPalCaptureResult): boolean {
	if (result.ok) {
		// A 2xx with a non-COMPLETED status means the order exists but the
		// payment is not yet final — keep retrying.
		return result.data.status !== 'COMPLETED';
	}
	if (result.status === 0 || result.status === 429 || result.status >= 500) return true;
	return false;
}
