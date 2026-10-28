// Addresses of the local real stack (see README). Defaults match `supabase start` with
// supabase-config.toml and the app on port 3140; override them to point elsewhere.
export const BASE = process.env.REAL_STACK_APP_URL ?? 'http://localhost:3140';
export const SB = process.env.REAL_STACK_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const MAIL = `${process.env.REAL_STACK_MAILPIT_URL ?? 'http://127.0.0.1:54324'}/api/v1`;
export const DB =
	process.env.REAL_STACK_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
