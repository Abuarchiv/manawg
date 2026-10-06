'use client';

import { safeLocalStorage } from '@/core/utils/browser';
import {
	type ResolvedTheme,
	THEME_STORAGE_KEY,
	type Theme,
	parseStoredTheme,
	resolveTheme,
} from '@/shared/lib/theme';
import { MotionConfig } from 'motion/react';
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';

interface ThemeContextValue {
	theme: Theme;
	resolvedTheme: ResolvedTheme;
	setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
	if (typeof window === 'undefined') return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(theme: Theme): ResolvedTheme {
	return resolveTheme(theme, systemPrefersDark());
}

function readStoredTheme(): Theme {
	return parseStoredTheme(safeLocalStorage()?.getItem(THEME_STORAGE_KEY) ?? null);
}

function writeStoredTheme(next: Theme): void {
	try {
		safeLocalStorage()?.setItem(THEME_STORAGE_KEY, next);
	} catch {
		// Storage may be blocked; theme still applies for this session.
	}
}

function applyResolved(next: ResolvedTheme): void {
	const root = document.documentElement;
	if (next === 'dark') root.classList.add('dark');
	else root.classList.remove('dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>('system');
	const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
	// The bootstrap script has already set the class; until the stored theme is read,
	// the 'light' initial value must not remove it again.
	const [ready, setReady] = useState(false);

	useEffect(() => {
		const initial = readStoredTheme();
		setReady(true);
		setThemeState(initial);
		const r = resolve(initial);
		setResolvedTheme(r);
	}, []);

	useEffect(() => {
		if (ready) applyResolved(resolvedTheme);
	}, [ready, resolvedTheme]);

	useEffect(() => {
		if (theme !== 'system' || typeof window === 'undefined') return;
		const mq = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = (): void => {
			const r: ResolvedTheme = mq.matches ? 'dark' : 'light';
			setResolvedTheme(r);
			applyResolved(r);
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	}, [theme]);

	useEffect(() => {
		if (typeof window === 'undefined') return;
		const onStorage = (event: StorageEvent): void => {
			if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
			const next = parseStoredTheme(event.newValue);
			setThemeState(next);
			setResolvedTheme(resolve(next));
		};
		window.addEventListener('storage', onStorage);
		return () => window.removeEventListener('storage', onStorage);
	}, []);

	const setTheme = useCallback((next: Theme) => {
		setThemeState(next);
		writeStoredTheme(next);
		const r = resolve(next);
		setResolvedTheme(r);
	}, []);

	const value = useMemo<ThemeContextValue>(
		() => ({ theme, resolvedTheme, setTheme }),
		[theme, resolvedTheme, setTheme],
	);

	return (
		<MotionConfig reducedMotion="user">
			<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
		</MotionConfig>
	);
}

export function useTheme(): ThemeContextValue {
	const ctx = useContext(ThemeContext);
	if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
	return ctx;
}
