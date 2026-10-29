import { useLocale, useTranslations } from 'next-intl';
import { formatDecimal } from '@/core/utils/amount';
import type { Locale } from '@/shared/i18n/locale';

/** "2 rolls" / "2 Rollen": the quantity in the reader's locale, the unit from the `inventory.unit` message. */
export function useQuantityText(): (quantity: number, unit: string) => string {
	const t = useTranslations('inventory');
	const locale = useLocale() as Locale;
	return (quantity, unit) =>
		`${formatDecimal(quantity, locale)} ${t('unit', { unit, count: quantity })}`;
}
