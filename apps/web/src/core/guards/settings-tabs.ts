import type { MessageKey } from '@/shared/i18n/message';

export type SettingsTab = 'profile' | 'notifications' | 'access' | 'data';

export const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: MessageKey; hash: string }> = [
	{ id: 'profile', label: 'settings.tabs.profile', hash: '#profile' },
	{ id: 'notifications', label: 'settings.tabs.notifications', hash: '#notifications' },
	{ id: 'access', label: 'settings.tabs.access', hash: '#access' },
	{ id: 'data', label: 'settings.tabs.data', hash: '#data' },
];

export function getSettingsTabFromHash(hash: string): SettingsTab {
	return SETTINGS_TABS.find((tab) => tab.hash === hash)?.id ?? 'profile';
}
