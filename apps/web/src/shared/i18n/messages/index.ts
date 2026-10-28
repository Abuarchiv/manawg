import de from './de';
import en from './en';

// `satisfies Catalog<typeof de>` already guarantees the same keys; next-intl types both
// locales by the German literals, so English is viewed through that type.
export default { de, en: en as typeof de } as const;
