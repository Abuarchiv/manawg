export * from './schema/announcements';
export * from './schema/chat';
export * from './schema/events';
export * from './schema/expenses';
export * from './schema/household';
export * from './schema/relations';
export * from './schema/system';
export * from './schema/wg';

const SHARE_CODE_LENGTH = 8;
const NAME_MAX = 80;
const TEXT_MAX = 2000;
const URL_MAX = 500;

export const LIMITS = {
	SHARE_CODE_LENGTH,
	NAME_MAX,
	TEXT_MAX,
	URL_MAX,
} as const;
