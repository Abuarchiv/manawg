import 'server-only';

import { createHash } from 'node:crypto';
import { AuthWeakPasswordError } from '@supabase/supabase-js';

// Have I Been Pwned range API: only the first five hex digits of the SHA-1 leave the server,
// and padded responses hide which prefix was asked for. Free, no key.
const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 2_000;

/** Whether the password is in a known breach. An unreachable service counts as "not known". */
export async function isPwnedPassword(password: string): Promise<boolean> {
	const hash = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
	const suffix = hash.slice(5);
	try {
		const response = await fetch(RANGE_URL + hash.slice(0, 5), {
			headers: { 'Add-Padding': 'true' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cache: 'no-store',
		});
		if (!response.ok) return false;
		for (const line of (await response.text()).split('\n')) {
			const [candidate, count] = line.trim().split(':');
			// Padding entries carry a count of 0.
			if (candidate === suffix) return Number(count) > 0;
		}
		return false;
	} catch {
		return false;
	}
}

/** Rejects a breached password with the same error Supabase uses, so clients show one message. */
export async function assertPasswordNotPwned(password: string): Promise<void> {
	if (await isPwnedPassword(password)) {
		throw new AuthWeakPasswordError('Password is known from a data breach', 422, ['pwned']);
	}
}
