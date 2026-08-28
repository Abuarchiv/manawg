export function formatQueuedOfflineActions(count: number): string {
	if (count === 1) return '1 Offline-Aktion wartet auf Synchronisierung.';
	return `${count} Offline-Aktionen warten auf Synchronisierung.`;
}

export function formatOfflineQueueCount(count: number): string {
	if (count === 0) return 'Keine wartenden Offline-Aktionen.';
	if (count === 1) return '1 Aktion wartet.';
	return `${count} Aktionen warten.`;
}

export function formatQueuedOfflineEntries(count: number): string {
	if (count === 1) return '1 Offline-Eintrag wartet auf Synchronisierung.';
	return `${count} Offline-Einträge warten auf Synchronisierung.`;
}

export function formatSyncedOfflineActions(count: number): string {
	if (count === 1) return '1 Offline-Aktion synchronisiert.';
	return `${count} Offline-Aktionen synchronisiert.`;
}

function formatSyncedActions(count: number, offlineLabel: boolean): string {
	if (offlineLabel) return formatSyncedOfflineActions(count);
	if (count === 1) return '1 Aktion synchronisiert.';
	return `${count} Aktionen synchronisiert.`;
}

function formatRemainingActions(count: number): string {
	if (count === 1) return '1 Aktion wartet weiter.';
	return `${count} Aktionen warten weiter.`;
}

export function formatManualOfflineSyncResult(
	synced: number,
	remaining: number,
	options?: { offlineLabel?: boolean },
): string {
	if (synced > 0 && remaining > 0) {
		return `${formatSyncedActions(synced, options?.offlineLabel ?? true)} ${formatRemainingActions(
			remaining,
		)}`;
	}
	if (synced > 0) return formatSyncedActions(synced, options?.offlineLabel ?? true);
	if (remaining === 0) return 'Keine wartenden Aktionen mehr.';
	return 'Noch nichts synchronisiert. Die Aktionen bleiben sicher gespeichert.';
}

export function getOfflineSyncFailureMessage(): string {
	return 'Synchronisierung konnte nicht gestartet werden. Prüfe deine Verbindung; die Aktionen bleiben gespeichert.';
}
