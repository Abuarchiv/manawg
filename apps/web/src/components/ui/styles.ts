import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';

/** Transitional string exports. New presentation code composes the lowercase UI components. */

/** Full-width text input / select / datetime field. */
export const FIELD_INPUT =
	'block h-11 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-1 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20';

/** Inline error / alert box. */
export const ALERT_DANGER =
	'rounded-lg border border-border bg-card px-2.5 py-2 text-sm text-destructive';

/** Error box that also holds an action on the right. */
export const ALERT_DANGER_ROW = `flex flex-wrap items-center justify-between gap-3 ${ALERT_DANGER}`;

/** Bordered list container whose rows are separated by hairlines. */
export const LIST_CARD =
	'divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-card-foreground';

/** Square icon-only button, no border. */
export const ICON_BUTTON = cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-11');

/** Square icon-only button with a border, used in toolbars. */
export const ICON_BUTTON_BORDERED = cn(
	buttonVariants({ variant: 'outline', size: 'icon' }),
	'size-11',
);

/** Pill-shaped secondary button, e.g. filter chips. */
export const CHIP_BUTTON = cn(buttonVariants({ variant: 'outline' }), 'h-11 px-3');

/** Dashed placeholder shown where a list has no entries yet. */
export const EMPTY_PLACEHOLDER =
	'rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground';
