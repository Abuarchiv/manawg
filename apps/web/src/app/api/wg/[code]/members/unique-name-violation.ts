import { findUniqueViolation } from '@/core/db/pg-errors';

/** True for a unique-index hit on (wg_id, name), e.g. a join and a rename racing for one name. */
export function isUniqueMemberNameViolation(err: unknown): boolean {
	const violation = findUniqueViolation(err);
	return (
		violation !== null &&
		(violation.constraint === null || violation.constraint === 'wg_members_unique_name_per_wg')
	);
}
