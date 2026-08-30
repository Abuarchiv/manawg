import { describe, expect, it } from 'vitest';
import { getSupabaseEnv } from './env';

describe('getSupabaseEnv', () => {
	it('returns the public Supabase URL and publishable key', () => {
		expect(
			getSupabaseEnv({
				NEXT_PUBLIC_SUPABASE_URL: ' https://project.supabase.co ',
				NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
			}),
		).toEqual({
			url: 'https://project.supabase.co',
			publishableKey: 'sb_publishable_test',
		});
	});

	it('fails clearly when public Supabase configuration is incomplete', () => {
		expect(() =>
			getSupabaseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' }),
		).toThrow('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required');
	});
});
