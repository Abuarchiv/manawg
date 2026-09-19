export function isPayPalCaptureDebtChanged(
	debtCents: number | undefined,
	captureAmountCents: number,
): boolean {
	return debtCents === undefined || debtCents !== captureAmountCents;
}

export type PayPalCaptureResult =
	| { ok: true; data: { status: string } }
	| { ok: false; status: number; error?: string };

export function shouldRetryPayPalCapture(result: PayPalCaptureResult): boolean {
	return result.ok || result.status === 0 || result.status >= 500;
}
