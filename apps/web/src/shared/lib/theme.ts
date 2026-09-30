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
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var s=t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||s){document.documentElement.classList.add('dark');}else{document.documentElement.classList.remove('dark');}}catch(e){}})();`;
