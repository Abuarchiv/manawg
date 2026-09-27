import { randomUUID } from 'node:crypto';

const PAYPAL_SANDBOX_URL = 'https://api-m.sandbox.paypal.com';
const PAYPAL_LIVE_URL = 'https://api-m.paypal.com';

export interface PayPalOrderResponse {
	id?: string;
	status?: string;
	purchase_units?: Array<{
		payments?: {
			captures?: Array<{
				status?: string;
				amount?: { currency_code?: string; value?: string };
			}>;
		};
	}>;
}

function getConfig(): {
	clientId: string;
	clientSecret: string;
	partnerAttributionId: string;
	baseUrl: string;
} | null {
	const clientId = process.env.PAYPAL_CLIENT_ID;
	const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
	const partnerAttributionId = process.env.PAYPAL_PARTNER_ATTRIBUTION_ID;
	const environment = process.env.PAYPAL_ENV;
	if (
		!clientId ||
		!clientSecret ||
		!partnerAttributionId ||
		(environment !== 'sandbox' && environment !== 'live')
	) {
		return null;
	}
	return {
		clientId,
		clientSecret,
		partnerAttributionId,
		baseUrl: environment === 'live' ? PAYPAL_LIVE_URL : PAYPAL_SANDBOX_URL,
	};
}

export function isPayPalConfigured(): boolean {
	return getConfig() !== null;
}

async function getAccessToken(config: {
	clientId: string;
	clientSecret: string;
	partnerAttributionId: string;
	baseUrl: string;
}): Promise<string> {
	const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
	const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${credentials}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
		cache: 'no-store',
	});
	if (!response.ok) throw new Error('paypal_token_failed');
	const body = (await response.json()) as { access_token?: unknown };
	if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
		throw new Error('paypal_token_missing');
	}
	return body.access_token;
}

function createPayPalAuthAssertion(clientId: string, merchantId: string): string {
	const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
	return `${encode({ alg: 'none' })}.${encode({ iss: clientId, payer_id: merchantId })}.`;
}

export async function requestPayPalApi<T>(
	path: string,
	init: RequestInit,
	payeeMerchantId?: string,
): Promise<T> {
	const config = getConfig();
	if (!config) throw new Error('paypal_not_configured');
	const accessToken = await getAccessToken(config);
	const authAssertion = payeeMerchantId
		? { 'PayPal-Auth-Assertion': createPayPalAuthAssertion(config.clientId, payeeMerchantId) }
		: {};
	const response = await fetch(`${config.baseUrl}${path}`, {
		...init,
		cache: 'no-store',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
			'PayPal-Partner-Attribution-Id': config.partnerAttributionId,
			...authAssertion,
			...(init.headers ?? {}),
		},
	});
	if (!response.ok) throw new Error(`paypal_api_${response.status}`);
	return (await response.json()) as T;
}

export async function createPayPalOrder(input: {
	amountCents: number;
	currency: string;
	description: string;
	payeeMerchantId: string;
	customId: string;
}): Promise<PayPalOrderResponse> {
	return requestPayPalApi<PayPalOrderResponse>(
		'/v2/checkout/orders',
		{
			method: 'POST',
			headers: { 'PayPal-Request-Id': randomUUID() },
			body: JSON.stringify({
				intent: 'CAPTURE',
				purchase_units: [
					{
						custom_id: input.customId,
						description: input.description,
						payee: { merchant_id: input.payeeMerchantId },
						amount: {
							currency_code: input.currency,
							value: (input.amountCents / 100).toFixed(2),
						},
					},
				],
			}),
		},
		input.payeeMerchantId,
	);
}

export async function capturePayPalOrder(
	orderId: string,
	payeeMerchantId: string,
): Promise<PayPalOrderResponse> {
	return requestPayPalApi<PayPalOrderResponse>(
		`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
		{
			method: 'POST',
			headers: { 'PayPal-Request-Id': orderId },
		},
		payeeMerchantId,
	);
}

export async function getPayPalOrder(
	orderId: string,
	payeeMerchantId: string,
): Promise<PayPalOrderResponse> {
	return requestPayPalApi<PayPalOrderResponse>(
		`/v2/checkout/orders/${encodeURIComponent(orderId)}`,
		{ method: 'GET' },
		payeeMerchantId,
	);
}
