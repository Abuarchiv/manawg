import { type NextRequest, NextResponse } from 'next/server';
import { rateLimitResponse } from '@/core/http/api-errors';
import {
	disableMailKind,
	type UnsubscribeKind,
	verifyUnsubscribeToken,
} from '@/core/mail/unsubscribe';
import { checkRateLimit, clientIpKey, unsubscribeLimiter } from '@/core/rate-limit';

const PAGE_HEADERS = {
	'Content-Type': 'text/html; charset=utf-8',
	'Cache-Control': 'private, no-store',
	'Referrer-Policy': 'no-referrer',
	'X-Robots-Tag': 'noindex',
};

const COPY: Record<
	UnsubscribeKind,
	{ title: string; question: string; explain: string; done: string }
> = {
	statement: {
		title: 'Monatsabrechnung abbestellen',
		question: 'Monatsabrechnung abbestellen?',
		explain:
			'Du bekommst die Abrechnung am Monatsanfang dann nicht mehr per E-Mail. In der App bleibt sie abrufbar.',
		done: 'Du bekommst keine Monatsabrechnung mehr per E-Mail. Unter Einstellungen in der App kannst du sie wieder einschalten.',
	},
	reminders: {
		title: 'Erinnerungen abbestellen',
		question: 'Erinnerungen an offene Beträge abbestellen?',
		explain:
			'Mitbewohner können dich dann nicht mehr per E-Mail oder Push an offene Beträge erinnern. Deine Salden bleiben in der App sichtbar.',
		done: 'Du bekommst keine Erinnerungen mehr. Unter Einstellungen in der App kannst du sie wieder einschalten.',
	},
};

function page(title: string, body: string): NextResponse {
	const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;background:#f5f5f5;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0a0a0a}main{box-sizing:border-box;max-width:480px;margin:48px auto;padding:32px;background:#fff;border:1px solid #e5e5e5}h1{margin:0 0 12px;font-size:24px;letter-spacing:-0.02em}p{margin:0 0 24px;font-size:15px;line-height:1.6;color:#404040}button{padding:13px 20px;border:0;border-radius:10px;background:#171717;color:#fafafa;font:500 15px Inter,sans-serif;cursor:pointer}small{display:block;margin-top:24px;font-size:12px;color:#737373}</style></head>
<body><main><div style="font-weight:600;margin-bottom:24px">ManaWG</div>${body}</main></body></html>`;
	return new NextResponse(html, { status: 200, headers: PAGE_HEADERS });
}

function invalid(): NextResponse {
	return new NextResponse('invalid_token', { status: 400 });
}

function limited(req: NextRequest): Promise<NextResponse | null> {
	return checkRateLimit(unsubscribeLimiter, `mail-unsubscribe:${clientIpKey(req)}`).then((result) =>
		rateLimitResponse(result, 'rate_limited'),
	);
}

/** Confirm page: opening the link alone never changes anything (mail scanners prefetch links). */
export async function GET(req: NextRequest): Promise<NextResponse> {
	const throttled = await limited(req);
	if (throttled) return throttled;
	const token = req.nextUrl.searchParams.get('t') ?? '';
	const parsed = verifyUnsubscribeToken(token);
	if (!parsed) return invalid();
	const copy = COPY[parsed.kind];
	return page(
		copy.title,
		`<h1>${copy.question}</h1><p>${copy.explain}</p><form method="post" action="/api/email/unsubscribe?t=${encodeURIComponent(token)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">Abbestellen</button></form><small>Du kannst es jederzeit unter Einstellungen wieder einschalten.</small>`,
	);
}

/** RFC 8058 one-click target and the confirm form's submit. */
export async function POST(req: NextRequest): Promise<NextResponse> {
	const throttled = await limited(req);
	if (throttled) return throttled;
	const parsed = verifyUnsubscribeToken(req.nextUrl.searchParams.get('t') ?? '');
	if (!parsed) return invalid();
	await disableMailKind(parsed.memberId, parsed.kind);
	return page('Abbestellt', `<h1>Abbestellt.</h1><p>${COPY[parsed.kind].done}</p>`);
}
