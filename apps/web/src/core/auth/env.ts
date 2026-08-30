type EnvSource = Record<string, string | undefined>;

export type SupabasePublicEnv = {
	url: string;
	publishableKey: string;
};

export function hasSupabaseEnv(env: EnvSource = process.env): boolean {
	return Boolean(
		env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
	);
}

export function getSupabaseEnv(env: EnvSource = process.env): SupabasePublicEnv {
	const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

	if (!url || !publishableKey) {
		throw new Error(
			'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required',
		);
	}

	return { url, publishableKey };
}
