import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export type EventScope = 'series' | 'occurrence';

/** For an event that repeats: does a change apply to the whole series or only to the opened date? */
export function EventScopeSwitch({
	scope,
	dateLabel,
	disabled,
	onChange,
}: {
	scope: EventScope;
	dateLabel: string;
	disabled: boolean;
	onChange: (scope: EventScope) => void;
}) {
	const t = useTranslations('events.edit');
	return (
		<fieldset className="flex flex-col gap-2" disabled={disabled}>
			<legend className="mb-1 text-sm font-medium">{t('scopeLegend')}</legend>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant={scope === 'series' ? 'default' : 'outline'}
					aria-pressed={scope === 'series'}
					className="min-h-11 flex-1"
					onClick={() => onChange('series')}
				>
					{t('scopeSeries')}
				</Button>
				<Button
					type="button"
					variant={scope === 'occurrence' ? 'default' : 'outline'}
					aria-pressed={scope === 'occurrence'}
					className="min-h-11 flex-1"
					onClick={() => onChange('occurrence')}
				>
					{t('scopeOccurrence', { date: dateLabel })}
				</Button>
			</div>
		</fieldset>
	);
}
