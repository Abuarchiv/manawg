import { auditSummaryMessage, parseAuditMetadata } from '@/core/audit-messages';
import { renderMessage, serverRootT } from '@/core/i18n/server-t';

export interface AuditRowInput {
	wgId: string;
	memberId?: string | null;
	eventType: string;
	entityType: string;
	entityId?: string | null;
	/** Name written in front of the stored sentence; passive sentences have none. */
	actorName?: string;
	/** Sentence parameters (names, titles, counts, amounts) plus context; never post or chat content. */
	metadata?: Record<string, unknown>;
}

/** The `audit_events` row for an event: the German summary is rendered from the same parameters the feed reads. */
export function auditValues(input: AuditRowInput) {
	const metadataJson = input.metadata ? JSON.stringify(input.metadata) : null;
	const message = auditSummaryMessage(
		input.eventType,
		input.actorName ?? '',
		parseAuditMetadata(metadataJson),
	);
	if (!message) throw new Error(`audit event ${input.eventType} lacks its sentence parameters`);
	return {
		wgId: input.wgId,
		memberId: input.memberId ?? null,
		eventType: input.eventType,
		entityType: input.entityType,
		entityId: input.entityId ?? null,
		summary: renderMessage(serverRootT('de'), message),
		metadataJson,
	};
}
