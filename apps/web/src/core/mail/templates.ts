import { serverT } from '@/core/i18n/server-t';
import { INVITE_VALID_DAYS, invitePath } from '@/core/utils/invite-token';
import { formatEuroCents } from '@/core/utils/money';
import { intlTag } from '@/shared/i18n/intl';
import { DEFAULT_LOCALE, type Locale } from '@/shared/i18n/locale';
import { APP_ORIGIN, type MailBlock, type RenderedMail, renderBrandMail } from './brand-mail';

/*
 * The transactional mails of the Touchpoints design (E1, E6, E7, E8, E10):
 * one thought per mail, amounts in mono, no exclamation marks, nothing that is
 * not actionable. E2–E5 are Supabase Auth templates, E9 is the statement mail.
 */

const WG_PATH = (shareCode: string) => `${APP_ORIGIN}/wg/${encodeURIComponent(shareCode)}`;

function joinNames(names: readonly string[], locale: Locale): string {
	return new Intl.ListFormat(intlTag(locale), { type: 'conjunction' }).format(names);
}

/** E1 · after the address is confirmed or the first social sign-in. */
export function renderWelcomeMail(input: {
	firstName: string | null;
	locale?: Locale;
}): RenderedMail {
	const locale = input.locale ?? DEFAULT_LOCALE;
	const t = serverT(locale, 'mail');
	return renderBrandMail({
		locale,
		subject: t('welcome.subject'),
		preheader: t('welcome.preheader'),
		eyebrow: 'ManaWG',
		title: t('welcome.title'),
		blocks: [
			{
				kind: 'paragraph',
				text: t('welcome.intro', {
					named: input.firstName ? 'yes' : 'other',
					firstName: input.firstName ?? '',
				}),
			},
			{
				kind: 'steps',
				items: [t('welcome.stepCreate'), t('welcome.stepInvite'), t('welcome.stepFirstExpense')],
			},
		],
		button: { label: t('welcome.button'), url: `${APP_ORIGIN}/neu` },
		footerNote: t('welcome.footer'),
	});
}

/** E6 · a member types an address; the mail carries a personal invitation link, valid for 7 days. */
export function renderInvitationMail(input: {
	inviterName: string;
	wgName: string;
	inviteToken: string;
	memberNames: readonly string[];
	locale?: Locale;
}): RenderedMail {
	const locale = input.locale ?? DEFAULT_LOCALE;
	const t = serverT(locale, 'mail');
	const others = input.memberNames.filter((name) => name !== input.inviterName);
	const names = [input.inviterName, ...others];
	const listed = joinNames(names.slice(0, 3), locale);
	const caption =
		names.length === 1
			? t('invitation.captionOne', { name: input.inviterName })
			: names.length > 3
				? t('invitation.captionMore', { names: listed, count: String(names.length - 3) })
				: t('invitation.captionMany', { names: listed });
	const joinUrl = `${APP_ORIGIN}${invitePath(input.inviteToken)}`;
	const title = { inviter: input.inviterName, wgName: input.wgName };
	return renderBrandMail({
		locale,
		subject: t('invitation.subject', title),
		preheader: t('invitation.preheader', { count: names.length }),
		eyebrow: t('invitation.eyebrow'),
		title: t('invitation.title', title),
		blocks: [{ kind: 'people', names, caption }],
		button: { label: t('invitation.button'), url: joinUrl },
		linkFallback: joinUrl,
		footerNote: t('invitation.footer', {
			days: String(INVITE_VALID_DAYS),
			inviter: input.inviterName,
		}),
	});
}

/** E8 · a creditor reminds a debtor who has no push; the debtor sees who and how much. */
export function renderReminderMail(input: {
	wgName: string;
	shareCode: string;
	creditorName: string;
	amountCents: number;
	oldestDebtAgeDays: number;
	items: ReadonlyArray<{ description: string; date: string; cents: number }>;
	unsubscribeUrl: string;
	locale?: Locale;
}): RenderedMail {
	const locale = input.locale ?? DEFAULT_LOCALE;
	const t = serverT(locale, 'mail');
	const money = (cents: number) => formatEuroCents(cents, 'EUR', { locale });
	const amount = money(input.amountCents);
	const creditor = { creditor: input.creditorName };
	const blocks: MailBlock[] = [
		{
			kind: 'amount',
			label: t('reminder.amountLabel', creditor),
			value: `−${amount}`,
			tone: 'owes',
		},
	];
	if (input.items.length > 0) {
		blocks.push({
			kind: 'rows',
			rows: input.items.map((item) => ({
				label: item.description,
				detail: item.date,
				value: money(item.cents),
			})),
		});
		// The list holds the newest unsettled shares; payments and shares the
		// other way are already netted into the amount above.
		const itemsCents = input.items.reduce((sum, item) => sum + item.cents, 0);
		if (itemsCents !== input.amountCents) {
			blocks.push({ kind: 'paragraph', text: t('reminder.netted') });
		}
	}
	blocks.push({ kind: 'paragraph', text: t('reminder.oneClick', creditor) });
	return renderBrandMail({
		locale,
		subject: t('reminder.subject', { ...creditor, amount }),
		preheader: t('reminder.age', { days: Math.max(0, input.oldestDebtAgeDays) }),
		eyebrow: t('reminder.eyebrow'),
		title: t('reminder.title', creditor),
		blocks,
		button: { label: t('reminder.button'), url: `${WG_PATH(input.shareCode)}/ausgaben` },
		footerNote: t('reminder.footer'),
		footerLinks: [
			{ label: t('shell.changeSettings'), url: `${WG_PATH(input.shareCode)}/einstellungen` },
			{ label: t('shell.unsubscribe'), url: input.unsubscribeUrl },
		],
	});
}

/** E10 · the last mail an account receives. */
export function renderAccountDeletedMail(locale: Locale = DEFAULT_LOCALE): RenderedMail {
	const t = serverT(locale, 'mail');
	return renderBrandMail({
		locale,
		subject: t('accountDeleted.subject'),
		preheader: t('accountDeleted.preheader'),
		eyebrow: 'ManaWG',
		title: t('accountDeleted.title'),
		blocks: [
			{ kind: 'paragraph', text: t('accountDeleted.removed') },
			{ kind: 'paragraph', text: t('accountDeleted.thanks') },
		],
		footerNote: t('accountDeleted.footer'),
	});
}
