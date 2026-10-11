import { captureException } from '@/core/infra/observability';
import { after } from 'next/server';

/**
 * Runs `task` once the response has been sent. Outside a Next request scope
 * (unit tests, scripts) `after` throws; the task then runs right away so no
 * mail is silently dropped.
 */
export function afterResponse(task: () => Promise<unknown>): void {
	const guarded = () => task().catch((err: unknown) => captureException(err));
	try {
		after(guarded);
	} catch {
		void guarded();
	}
}
