import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { QUICK_CHORE_TEMPLATES } from '@/features/chores/components/constants';
import type { ChoreSuggestion } from '@/features/chores/hooks/use-chore-create';
import { useMessage } from '@/shared/i18n/message';

/** Shown instead of the list: after a failed first load, or when there are no chores yet. */
export function ChoreListEmpty({
	loadFailed,
	onQuickChore,
}: {
	loadFailed: boolean;
	onQuickChore: (template: ChoreSuggestion) => void;
}) {
	const t = useTranslations('chores.empty');
	const render = useMessage();
	if (loadFailed) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyTitle>{t('notLoadedTitle')}</EmptyTitle>
					<EmptyDescription>{t('notLoadedBody')}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Sparkles aria-hidden />
				</EmptyMedia>
				<EmptyTitle>{t('title')}</EmptyTitle>
				<EmptyDescription>{t('body')}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row flex-wrap justify-center">
				{QUICK_CHORE_TEMPLATES.map((template) => {
					const title = render(template.title);
					return (
						<Button
							key={template.title.key}
							variant="outline"
							onClick={() =>
								onQuickChore({
									title,
									intervalDays: template.intervalDays,
									recurrenceType: template.recurrenceType,
								})
							}
						>
							{title}
						</Button>
					);
				})}
			</EmptyContent>
		</Empty>
	);
}
