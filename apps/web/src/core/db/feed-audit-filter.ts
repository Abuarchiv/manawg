import { and, eq, notInArray } from 'drizzle-orm';
import { HIDDEN_FROM_FEED_EVENT_TYPES } from '../audit-visibility';
import { auditEvents } from './schema';

/**
 * The audit rows of one WG that every member may see in a shared feed.
 * `alsoHidden` adds event types a particular feed drops on top of the private ones.
 */
export function feedAuditCondition(wgId: string, alsoHidden: readonly string[] = []) {
	return and(
		eq(auditEvents.wgId, wgId),
		notInArray(auditEvents.eventType, [...HIDDEN_FROM_FEED_EVENT_TYPES, ...alsoHidden]),
	);
}
