import { Button } from '@/components/ui/button';
import { DrawerFooter } from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { CalendarPlus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Save, cancel, calendar export and delete for the event drawer; read-only viewers only close or export. */
export function EventEditFooter({
	readOnly,
	busy,
	saving,
	onCancel,
	onDelete,
	deleteLabel,
	onExportIcs,
}: {
	readOnly: boolean;
	busy: boolean;
	saving: boolean;
	onCancel: () => void;
	onDelete: () => void;
	deleteLabel: string;
	onExportIcs?: (() => void) | undefined;
}) {
	const t = useTranslations('events');
	return (
		<DrawerFooter className="border-t pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
			<div className="flex flex-wrap gap-2">
				{!readOnly && (
					<Button type="submit" className="min-w-fit flex-1" disabled={busy}>
						{saving && <Spinner data-icon="inline-start" aria-hidden />}
						{saving ? t('actions.saving') : t('actions.save')}
					</Button>
				)}
				<Button
					type="button"
					variant="outline"
					className="min-w-fit flex-1"
					onClick={onCancel}
					disabled={busy}
				>
					{readOnly ? t('actions.close') : t('actions.cancel')}
				</Button>
			</div>
			<div className="flex flex-wrap gap-2">
				{onExportIcs && (
					<Button
						type="button"
						variant="outline"
						className="h-auto min-h-8 min-w-fit flex-1 py-1.5"
						onClick={onExportIcs}
						aria-label={t('edit.addToCalendarLabel')}
					>
						<CalendarPlus data-icon="inline-start" aria-hidden />
						{t('edit.addToCalendar')}
					</Button>
				)}
				{!readOnly && (
					<Button
						type="button"
						variant="destructive"
						className="h-auto min-h-8 min-w-fit flex-1 py-1.5"
						onClick={onDelete}
						disabled={busy}
						aria-label={deleteLabel}
					>
						<Trash2 data-icon="inline-start" aria-hidden />
						{deleteLabel}
					</Button>
				)}
			</div>
		</DrawerFooter>
	);
}
