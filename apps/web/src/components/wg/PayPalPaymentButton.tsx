'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiFetch } from '@/core/infra/api-client';
import { formatEuroCents } from '@/core/utils/money';
import { shouldRetryPayPalCapture } from '@/features/expenses/paypal-settlement';
import { useEffect, useRef, useState } from 'react';

interface PayPalButtonsInstance {
	render(container: HTMLElement): Promise<void>;
	close?(): Promise<void>;
}

interface PayPalNamespace {
	Buttons(options: {
		createOrder: () => Promise<string>;
		onApprove: (data: { orderID: string }) => Promise<void>;
		onCancel?: () => void;
		onError: (error: unknown) => void;
	}): PayPalButtonsInstance;
}

declare global {
	interface Window {
		[key: string]: unknown;
	}
}

const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const PAYPAL_PARTNER_ATTRIBUTION_ID = process.env.NEXT_PUBLIC_PAYPAL_PARTNER_ATTRIBUTION_ID;
const PAYPAL_ERROR =
	'PayPal konnte die Zahlung nicht bestätigen. Prüfe den Zahlungsstatus bei PayPal, bevor du erneut zahlst oder die Zahlung als beglichen vermerkst.';
const payPalSdkLoads = new Map<string, Promise<void>>();

function sdkNamespace(merchantId: string): string {
	return `p${merchantId}`;
}

function paypalFor(merchantId: string): PayPalNamespace | undefined {
	// The namespace is written by PayPal's injected script — treat it as
	// untrusted input instead of casting blindly.
	const candidate: unknown = window[sdkNamespace(merchantId)];
	if (typeof candidate !== 'object' || candidate === null) return undefined;
	if (typeof (candidate as { Buttons?: unknown }).Buttons !== 'function') return undefined;
	return candidate as PayPalNamespace;
}

function loadPayPalSdk(merchantId: string): Promise<void> {
	if (paypalFor(merchantId)) return Promise.resolve();
	const pending = payPalSdkLoads.get(merchantId);
	if (pending) return pending;
	const load = new Promise<void>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = `https://www.paypal.com/sdk/js?${new URLSearchParams({
			'client-id': PAYPAL_CLIENT_ID ?? '',
			'merchant-id': merchantId,
			currency: 'EUR',
		})}`;
		script.dataset.namespace = sdkNamespace(merchantId);
		script.dataset.partnerAttributionId = PAYPAL_PARTNER_ATTRIBUTION_ID ?? '';
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => {
			payPalSdkLoads.delete(merchantId);
			reject(new Error());
		};
		document.head.appendChild(script);
	});
	payPalSdkLoads.set(merchantId, load);
	return load;
}

interface PayPalPaymentButtonProps {
	shareCode: string;
	currentMemberId: string;
	memberToken?: string | undefined;
	fromMemberId: string;
	toMemberId: string;
	payeeMerchantId: string;
	amountCents: number;
	currency: string;
	onPaid: () => void;
}

export function PayPalPaymentButton({
	shareCode,
	currentMemberId,
	memberToken,
	fromMemberId,
	toMemberId,
	payeeMerchantId,
	amountCents,
	currency,
	onPaid,
}: PayPalPaymentButtonProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const onPaidRef = useRef(onPaid);
	const [error, setError] = useState<string | null>(null);
	onPaidRef.current = onPaid;

	useEffect(() => {
		if (!PAYPAL_CLIENT_ID || !PAYPAL_PARTNER_ATTRIBUTION_ID || !containerRef.current) return;
		let cancelled = false;
		let buttons: PayPalButtonsInstance | undefined;

		const createOrder = async (): Promise<string> => {
			const result = await apiFetch<{ orderId: string }>(
				`/api/wg/${encodeURIComponent(shareCode)}/paypal/order`,
				{
					method: 'POST',
					memberId: currentMemberId,
					memberToken,
					body: JSON.stringify({ fromMemberId, toMemberId, currency }),
				},
			);
			if (!result.ok) throw new Error(result.error);
			return result.data.orderId;
		};

		const onApprove = async (data: { orderID: string }): Promise<void> => {
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const result = await apiFetch<{ status: string }>(
					`/api/wg/${encodeURIComponent(shareCode)}/paypal/capture`,
					{
						method: 'POST',
						memberId: currentMemberId,
						memberToken,
						body: JSON.stringify({ orderId: data.orderID }),
					},
				);
				if (result.ok && result.data.status === 'COMPLETED') {
					onPaidRef.current();
					return;
				}
				if (!shouldRetryPayPalCapture(result)) break;
			}
			throw new Error();
		};

		void loadPayPalSdk(payeeMerchantId)
			.then(() => {
				const paypal = paypalFor(payeeMerchantId);
				if (cancelled || !containerRef.current || !paypal) return;
				buttons = paypal.Buttons({
					createOrder,
					onApprove,
					onError: () => setError(PAYPAL_ERROR),
				});
				return buttons.render(containerRef.current);
			})
			.catch(() => {
				if (!cancelled) setError(PAYPAL_ERROR);
			});

		return () => {
			cancelled = true;
			void buttons?.close?.();
		};
	}, [
		currentMemberId,
		currency,
		fromMemberId,
		memberToken,
		payeeMerchantId,
		shareCode,
		toMemberId,
	]);

	if (!PAYPAL_CLIENT_ID || !PAYPAL_PARTNER_ATTRIBUTION_ID) return null;
	return (
		<div className="flex flex-col gap-3 pt-3">
			<p className="text-sm text-muted-foreground">
				PayPal-Zahlung über {formatEuroCents(amountCents, currency)}. Erst bei PayPal bestätigen;
				ein Abbruch verbucht keinen Ausgleich.
			</p>
			<div
				ref={containerRef}
				aria-label={`PayPal ${formatEuroCents(amountCents, currency)} zahlen`}
				role="group"
			/>
			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
		</div>
	);
}
