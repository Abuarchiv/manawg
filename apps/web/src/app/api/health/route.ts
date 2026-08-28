import { checkEnv } from '@/lib/env';
import { checkRateLimit, clientIpKey, healthLimiter } from '@/lib/rate-limit';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/**
 * Readiness probe.
 *
 * Deliberately says nothing an attacker could use: no variable values, no
 * connection strings, no error text from the database. It answers one question
 * — can this instance serve traffic correctly — plus the names of features that
 * are switched off, so a deploy that silently lost its Redis or VAPID config is
 * visible without reading logs.
 *
 * It carries its own rate limit because `/api/health` is not in the middleware
 * matcher — without one, an unauthenticated caller could drive a database query
 * per request.
 */

export const dynamic = 'force-dynamic';

const DB_PROBE_TIMEOUT_MS = 2_000;

type ProbeStatus = 'ok' | 'unreachable';

async function probeDatabase(): Promise<ProbeStatus> {
	try {
		const { db } = await import('@/lib/db');
		const { sql } = await import('drizzle-orm');
		await Promise.race([
			db.execute(sql`select 1`),
			new Promise((_resolve, reject) =>
				setTimeout(() => reject(new Error('db probe timed out')), DB_PROBE_TIMEOUT_MS),
			),
		]);
		return 'ok';
	} catch {
		// The reason belongs in the logs, not in an unauthenticated response.
		return 'unreachable';
	}
}

export async function GET(req: NextRequest): Promise<NextResponse> {
	const limit = await checkRateLimit(healthLimiter, `health:${clientIpKey(req)}`);
	if (!limit.success) {
		return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
	}

	const env = checkEnv(process.env);
	const database = await probeDatabase();
	const healthy = env.ok && database === 'ok';

	return NextResponse.json(
		{
			status: healthy ? 'ok' : 'degraded',
			database,
			// Count only — variable names would enable config enumeration.
			missingRequiredCount: env.missingRequired.length,
			degradedFeatures: env.degraded.map((entry) => entry.feature),
		},
		{
			status: healthy ? 200 : 503,
			headers: { 'Cache-Control': 'no-store' },
		},
	);
}
