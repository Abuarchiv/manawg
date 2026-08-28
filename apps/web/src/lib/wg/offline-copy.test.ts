import { describe, expect, it } from 'vitest';
import {
	formatManualOfflineSyncResult,
	formatOfflineQueueCount,
	formatQueuedOfflineActions,
	formatQueuedOfflineEntries,
	formatSyncedOfflineActions,
	getOfflineSyncFailureMessage,
} from './offline-copy';

describe('offline copy helpers', () => {
	it('formats queued offline action counts with correct singular and plural text', () => {
		expect(formatQueuedOfflineActions(1)).toBe('1 Offline-Aktion wartet auf Synchronisierung.');
		expect(formatQueuedOfflineActions(2)).toBe('2 Offline-Aktionen warten auf Synchronisierung.');
	});

	it('formats settings offline queue counts including the empty state', () => {
		expect(formatOfflineQueueCount(0)).toBe('Keine wartenden Offline-Aktionen.');
		expect(formatOfflineQueueCount(1)).toBe('1 Aktion wartet.');
		expect(formatOfflineQueueCount(2)).toBe('2 Aktionen warten.');
	});

	it('formats queued offline entry counts with correct singular and plural text', () => {
		expect(formatQueuedOfflineEntries(1)).toBe('1 Offline-Eintrag wartet auf Synchronisierung.');
		expect(formatQueuedOfflineEntries(2)).toBe('2 Offline-Einträge warten auf Synchronisierung.');
	});

	it('formats synced offline action counts with correct singular and plural text', () => {
		expect(formatSyncedOfflineActions(1)).toBe('1 Offline-Aktion synchronisiert.');
		expect(formatSyncedOfflineActions(2)).toBe('2 Offline-Aktionen synchronisiert.');
	});

	it('keeps manual sync result copy honest when actions remain queued', () => {
		expect(formatManualOfflineSyncResult(1, 1)).toBe(
			'1 Offline-Aktion synchronisiert. 1 Aktion wartet weiter.',
		);
		expect(formatManualOfflineSyncResult(2, 3)).toBe(
			'2 Offline-Aktionen synchronisiert. 3 Aktionen warten weiter.',
		);
		expect(formatManualOfflineSyncResult(1, 1, { offlineLabel: false })).toBe(
			'1 Aktion synchronisiert. 1 Aktion wartet weiter.',
		);
	});

	it('explains manual syncs without progress without implying queued actions were lost', () => {
		expect(formatManualOfflineSyncResult(0, 2)).toBe(
			'Noch nichts synchronisiert. Die Aktionen bleiben sicher gespeichert.',
		);
	});

	it('explains manual syncs without progress when no queued action remains', () => {
		expect(formatManualOfflineSyncResult(0, 0)).toBe('Keine wartenden Aktionen mehr.');
	});

	it('explains failed manual syncs without implying queued actions were lost', () => {
		expect(getOfflineSyncFailureMessage()).toBe(
			'Synchronisierung konnte nicht gestartet werden. Prüfe deine Verbindung; die Aktionen bleiben gespeichert.',
		);
	});
});
