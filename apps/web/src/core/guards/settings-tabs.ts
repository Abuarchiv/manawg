export type SettingsTab = 'profile' | 'notifications' | 'access' | 'data';

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string; hash: string }> = [
	{ id: 'profile', label: 'Profil', hash: '#profil' },
	{ id: 'notifications', label: 'Benachrichtigungen', hash: '#benachrichtigungen' },
	{ id: 'access', label: 'Zugang', hash: '#zugang' },
	{ id: 'data', label: 'Daten', hash: '#daten' },
];

export function getSettingsTabFromHash(hash: string): SettingsTab {
	return SETTINGS_TABS.find((tab) => tab.hash === hash)?.id ?? 'profile';
}
