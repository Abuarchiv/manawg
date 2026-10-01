export type SupabasePublicEnv = {
	url: string;
	publishableKey: string;
};

export function hasSupabaseEnv(): boolean {
	return Boolean(
		process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
			process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim(),
	);
}

export function getSupabaseEnv(): SupabasePublicEnv {
	// Next.js only inlines direct NEXT_PUBLIC reads into the browser bundle.
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
	const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

	if (!url || !publishableKey) {
		throw new Error(
			'NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required',
		);
	}

	return { url, publishableKey };
}
