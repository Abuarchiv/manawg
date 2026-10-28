import { formatEuroCents } from '@/core/utils/money';
import type { Locale } from '@/shared/i18n/locale';

const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * The amount of an expense notice in the reader's locale. New messages carry `amountCents` and
 * `currency`; older ones only the text formatted when they were written.
 */
export function systemAmountText(data: Record<string, unknown>, locale: Locale): string | null {
	const { amountCents, currency, amount } = data;
	if (typeof amountCents === 'number' && Number.isFinite(amountCents)) {
		const code = typeof currency === 'string' && CURRENCY_CODE.test(currency) ? currency : 'EUR';
		return formatEuroCents(amountCents, code, { locale });
	}
	return typeof amount === 'string' && amount.trim().length > 0 ? amount.trim() : null;
}
