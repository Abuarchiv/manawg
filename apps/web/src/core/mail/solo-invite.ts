import 'server-only';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { loadConfirmedEmails } from '@/core/auth/auth-user-emails';
import { db, wgMembers, wgs } from '@/core/db';
import { resolveLocale } from '@/shared/i18n/locale';
import { sendMailSafely } from './send-mail';
import { renderSoloInviteMail } from './templates';
import { unsubscribeUrl } from './unsubscribe';

// Sent one after another inside the maintenance cron (60 s limit, killed after that). No new
// mail starts after the budget, and one provider request takes at most 15 s; what is left waits
// for the next day, which the 48 h window still covers.
const RUN_LIMIT = 50;
const SEND_BUDGET_MS = 30_000;

export interface SoloInviteRun {
	candidates: number;
	sent: number;
	/** No confirmed address, or the mail already went out. */
	skipped: number;
	failed: number;
	/** Left for the next run: the time budget ran out or the provider asked to wait. */
	deferred: number;
}

/**
 * WGs created between 24 and 72 hours ago that still have fewer than two active members, with
 * their active admin (the creator, unless the admin role moved on). The upper bound keeps older
 * WGs out when the job first runs; WGs whose mail went out, admins who opted out and accounts
 * being deleted are left out.
 */
export function findSoloInviteCandidates(limit = RUN_LIMIT) {
	return db
		.select({
			wgId: wgs.id,
			wgName: wgs.name,
			shareCode: wgs.shareCode,
			memberId: wgMembers.id,
			authUserId: sql<string>`${wgMembers.authUserId}`,
			locale: wgMembers.locale,
		})
		.from(wgs)
		.innerJoin(
			wgMembers,
			and(
				eq(wgMembers.wgId, wgs.id),
				eq(wgMembers.role, 'admin'),
				isNull(wgMembers.deactivatedAt),
				isNotNull(wgMembers.authUserId),
				eq(wgMembers.notifyOnboardingEmail, true),
			),
		)
		.where(
			and(
				sql`${wgs.createdAt} <= now() - interval '24 hours'`,
				sql`${wgs.createdAt} > now() - interval '72 hours'`,
				sql`(select count(*) from wg_members m where m.wg_id = ${wgs.id} and m.deactivated_at is null) < 2`,
				sql`not exists (select 1 from mail_log l where l.dedupe_key = 'solo_invite:' || ${wgs.id}::text and l.status = 'sent')`,
				sql`not exists (select 1 from account_deletions d where d.auth_user_id = ${wgMembers.authUserId})`,
			),
		)
		.orderBy(wgs.createdAt)
		.limit(limit);
}

/** Sends the one invitation reminder per still-alone WG (dedupe key `solo_invite:<wgId>`). */
export async function sendSoloInviteMails(budgetMs = SEND_BUDGET_MS): Promise<SoloInviteRun> {
	const deadline = Date.now() + budgetMs;
	const candidates = await findSoloInviteCandidates();
	const run: SoloInviteRun = {
		candidates: candidates.length,
		sent: 0,
		skipped: 0,
		failed: 0,
		deferred: 0,
	};
	if (candidates.length === 0) return run;
	const { emails } = await loadConfirmedEmails(candidates.map((row) => row.authUserId));
	for (const [index, row] of candidates.entries()) {
		if (Date.now() > deadline) {
			run.deferred += candidates.length - index;
			break;
		}
		const to = emails.get(row.authUserId);
		if (!to) {
			run.skipped++;
			continue;
		}
		const unsubscribe = unsubscribeUrl(row.memberId, 'onboarding');
		const result = await sendMailSafely({
			kind: 'solo_invite',
			dedupeKey: `solo_invite:${row.wgId}`,
			to,
			wgId: row.wgId,
			memberId: row.memberId,
			unsubscribeUrl: unsubscribe,
			mail: renderSoloInviteMail({
				wgName: row.wgName,
				shareCode: row.shareCode,
				unsubscribeUrl: unsubscribe,
				locale: resolveLocale({ cookie: row.locale }),
			}),
		});
		if (result === 'sent' || result === 'unconfirmed') run.sent++;
		else if (result === 'duplicate') run.skipped++;
		else if (result === 'deferred') {
			// Quota reached: the next mails would be deferred as well.
			run.deferred += candidates.length - index;
			break;
		} else run.failed++;
	}
	return run;
}
