export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'manawg-theme';

export function parseStoredTheme(value: string | null): Theme {
	return value === 'dark' || value === 'light' || value === 'system' ? value : 'system';
}

export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
	if (theme === 'system') return systemDark ? 'dark' : 'light';
	return theme;
}

/** Runs before first paint (layout and global-error) so dark mode never flashes white. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var s=t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var d=t==='dark'||s;document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

/** Same logic as THEME_BOOTSTRAP_SCRIPT, callable from client code (inline scripts do not run on client renders, and new Function() is blocked by a strict CSP). */
export function applyStoredTheme(): void {
	try {
		const theme = parseStoredTheme(localStorage.getItem(THEME_STORAGE_KEY));
		const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
		const resolved = resolveTheme(theme, systemDark);
		document.documentElement.classList.toggle('dark', resolved === 'dark');
		document.documentElement.style.colorScheme = resolved;
	} catch {
		// Storage blocked: keep whatever class the document has.
	}
}
