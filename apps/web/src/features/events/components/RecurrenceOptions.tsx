import { NativeSelectOption } from '@/components/ui/native-select';
import { RECURRENCE_OPTIONS } from '@/features/events/events';
import { useMessage } from '@/shared/i18n/message';

/** The repeat choices of the event forms as `<option>` elements. */
export function RecurrenceOptions() {
	const render = useMessage();
	return RECURRENCE_OPTIONS.map((option) => (
		<NativeSelectOption key={option.value} value={option.value}>
			{render(option.label)}
		</NativeSelectOption>
	));
}
