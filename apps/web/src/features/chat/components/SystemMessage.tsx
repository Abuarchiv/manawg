import { CheckCircle2, Info, LogIn, LogOut, Receipt } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { richArgument } from '@/components/entry/rich-argument';
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker';
import type { Locale } from '@/shared/i18n/locale';
import { systemAmountText } from '../chat-system';

interface SystemMessageProps {
	shareCode: string;
	systemKind: string | null;
	payload: Record<string, unknown> | null;
}

function asString(value: unknown, fallback: string): string {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export function SystemMessage({ shareCode, systemKind, payload }: SystemMessageProps) {
	const t = useTranslations('chat.system');
	const locale = useLocale() as Locale;
	const data = payload ?? {};
	const someone = t('someone');
	switch (systemKind) {
		case 'member.joined':
			return <SystemRow icon={LogIn} text={t('joined', { name: asString(data.name, someone) })} />;
		case 'member.left':
			return <SystemRow icon={LogOut} text={t('left', { name: asString(data.name, someone) })} />;
		case 'expense.created': {
			const text = t.rich('expenseCreated', {
				actor: asString(data.actorName, someone),
				description: asString(data.description, t('anExpense')),
				amount: richArgument(
					<span className="tabular-nums">{systemAmountText(data, locale) ?? t('zeroAmount')}</span>,
				),
			});
			// Older messages carry no expenseId and stay plain text.
			const expenseId = asString(data.expenseId, '');
			return (
				<SystemRow
					icon={Receipt}
					text={
						expenseId ? (
							<Link
								href={`/wg/${encodeURIComponent(shareCode)}/expenses?highlight=${encodeURIComponent(expenseId)}`}
								// The after pseudo-element extends the hit area to 44px without enlarging the pill.
								className="relative underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-3.5 focus-visible:outline-2 focus-visible:outline-offset-2"
							>
								{text}
							</Link>
						) : (
							text
						)
					}
				/>
			);
		}
		case 'chore.completed': {
			const actor = asString(data.actorName, someone);
			const title = asString(data.title, '');
			return (
				<SystemRow
					icon={CheckCircle2}
					text={
						title ? t('choreCompleted', { actor, title }) : t('choreCompletedNoTitle', { actor })
					}
				/>
			);
		}
		default:
			return <SystemRow icon={Info} text={t('unknown')} />;
	}
}

function SystemRow({ icon: Icon, text }: { icon: typeof CheckCircle2; text: ReactNode }) {
	return (
		<Marker
			variant="separator"
			className="my-2 justify-center text-xs before:min-w-3 after:min-w-3"
		>
			<MarkerIcon>
				<Icon aria-hidden />
			</MarkerIcon>
			<MarkerContent className="max-w-[85%] rounded-2xl bg-muted px-3 py-1 text-center text-foreground/80">
				{text}
			</MarkerContent>
		</Marker>
	);
}
