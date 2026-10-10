import { after } from 'next/server';

/**
 * Runs `task` once the response has been sent. Outside a Next request scope
 * (unit tests, scripts) `after` throws; the task then runs right away so no
 * mail is silently dropped.
 */
export function afterResponse(task: () => Promise<unknown>): void {
	try {
		after(task);
	} catch {
		void task();
	}
}
