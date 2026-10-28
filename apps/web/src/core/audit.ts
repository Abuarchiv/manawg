import { type AuditRowInput, auditValues } from '@/core/audit-values';
import { auditEvents, db } from '@/core/db';
import { logApiError } from '@/core/infra/observability';

export async function recordAuditEvent(input: AuditRowInput): Promise<void> {
	try {
		await db.insert(auditEvents).values(auditValues(input));
	} catch (err) {
		// Keep mutations best-effort: propagating an audit failure after the
		// mutation would make clients retry successful writes. Surface the loss
		// at error level so the platform log can alert on it.
		logApiError('[audit] event not recorded', err);
	}
}
