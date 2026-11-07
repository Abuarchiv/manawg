import de from './de';
import en from './en';
import es from './es';

// `satisfies Catalog<typeof de>` already guarantees the same keys; next-intl types all
// locales by the German literals, so English and Spanish are viewed through that type.
export default { de, en: en as typeof de, es: es as typeof de } as const;
