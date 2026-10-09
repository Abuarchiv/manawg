import {
	getPayPalEnvironment,
	getTrustedPayPalAppOrigin,
	isPayPalMerchantId,
	readPayPalConnectionCookie,
	verifyPayPalConnectionCookie,
} from '@/core/infra/paypal-onboarding';
import { type NextRequest, NextResponse } from 'next/server';

function redirect(location: string): NextResponse {
	return new NextResponse(null, {
		status: 303,
		headers: {
			Location: location,
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
		},
	});
}

/** No trusted app origin to send the visitor back to, so say so on a page instead of raw JSON. */
function unavailablePage(): NextResponse {
	const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>PayPal-Verbindung – ManaWG</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1>PayPal-Verbindung gerade nicht möglich</h1><p>Die Verbindung konnte nicht abgeschlossen werden. Öffne ManaWG und versuche es in den Einstellungen deiner WG erneut.</p><p><a href="/">Zu ManaWG</a></p></body></html>`;
	return new NextResponse(html, {
		status: 503,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
		},
	});
}

export function GET(req: NextRequest): NextResponse {
	const environment = getPayPalEnvironment();
	const appOrigin = getTrustedPayPalAppOrigin(environment);
	if (!environment || !appOrigin) {
		return unavailablePage();
	}

	const callbackUrl = new URL(req.url);
	const state = verifyPayPalConnectionCookie(readPayPalConnectionCookie(req), { environment });
	if (!state || callbackUrl.searchParams.get('state') !== state.nonce) {
		return redirect(new URL('/', appOrigin).toString());
	}

	const destination = new URL(`/wg/${encodeURIComponent(state.code)}/einstellungen`, appOrigin);
	destination.searchParams.set('paypal', 'return');
	const merchantId = callbackUrl.searchParams.get('merchantIdInPayPal');
	if (isPayPalMerchantId(merchantId)) {
		destination.searchParams.set('merchantIdInPayPal', merchantId);
	}
	return redirect(destination.toString());
}
